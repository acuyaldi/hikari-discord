import OpenAI from 'openai';
import {
  DEBUG_AI,
  OPENROUTER_ALLOW_PAID_FALLBACK,
  OPENROUTER_API_KEY,
  OPENROUTER_MODELS,
} from '../../../config/env';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';
import {
  TOOL_LOOP_FALLBACK_MESSAGE,
  runWithTools,
} from '../../tools/toolExecutionLoop';
import { openAICompatibleToolAdapter } from '../../tools/providerAdapters/openaiCompatibleToolAdapter';
import type { OpenAICompatibleToolState } from '../../tools/providerAdapters/openaiCompatibleToolAdapter';
import type { ToolProviderAdapter } from '../../tools/types';
import { recordModelSuccess, recordModelFailure } from '../providerMetrics';
import {
  circuitBreaker as defaultCircuitBreaker,
  isTransientAIError,
  type CircuitBreaker,
} from '../circuitBreaker';
import { markCooldown, recordHealthFailure, recordHealthSuccess } from '../healthCache';
import { rankTargets } from '../providerRanking';

const client = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const DEBUG = DEBUG_AI;

type OpenRouterMessage = { role: string; content?: unknown; [key: string]: unknown };
type OpenRouterCompletion = {
  choices: {
    message?: {
      content?: string | null;
      tool_calls?: unknown[];
    };
  }[];
};
type OpenRouterCreateParams = {
  model: string;
  messages: OpenRouterMessage[];
  tools?: Array<Record<string, unknown>>;
};

interface OpenRouterClient {
  chat: {
    completions: {
      create(params: OpenRouterCreateParams): Promise<OpenRouterCompletion>;
    };
  };
}

interface OpenRouterProviderOptions {
  apiKey?: string;
  models?: string[];
  circuitBreaker?: CircuitBreaker;
  client?: OpenRouterClient;
  allowPaidFallback?: boolean;
}

function extractSuggestedSlug(message: string): string | null {
  const match = message.match(/use this slug instead:\s*([^\s]+)/i);
  return match?.[1]?.trim() ?? null;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    const s = err.status;
    if (s === 400 || s === 401 || s === 403) return false;
    if (s === 429 || s >= 500) return true;
  }
  return true;
}

function getErrorStatus(err: unknown): number | undefined {
  if (err instanceof OpenAI.APIError) return err.status;
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

export class OpenRouterProvider implements AIProvider {
  readonly name = AIProviderName.OPENROUTER;
  readonly supportsVision = false;
  readonly supportsReasoning = false;
  readonly supportsCoding = true;

  private readonly apiKey: string;
  private readonly models: string[];
  private readonly circuitBreaker: CircuitBreaker;
  private readonly client: OpenRouterClient;
  private readonly allowPaidFallback: boolean;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.apiKey = options.apiKey ?? OPENROUTER_API_KEY;
    this.models = options.models ?? OPENROUTER_MODELS;
    this.allowPaidFallback = options.allowPaidFallback ?? OPENROUTER_ALLOW_PAID_FALLBACK;
    this.circuitBreaker = options.circuitBreaker ?? defaultCircuitBreaker;
    this.client =
      options.client ??
      ({
        chat: {
          completions: {
            create: async (params) => client.chat.completions.create(params as never) as Promise<OpenRouterCompletion>,
          },
        },
      } satisfies OpenRouterClient);
  }

  async generate(request: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY not configured');

    const { dynamicSystemInstruction, finalPrompt } = request;
    const messages: OpenRouterMessage[] = [
      { role: 'system', content: dynamicSystemInstruction },
      { role: 'user', content: finalPrompt },
    ];

    const errors: { model: string; error: string }[] = [];
    let skippedModels = 0;
    const attemptedModels = new Set<string>();
    const modelTargets = this.models.map((model) => `openrouter:${model}`);
    const rankedTargets = rankTargets(modelTargets);

    if (DEBUG) {
      console.log(
        [
          '[OpenRouter Ranking]',
          `order before: ${modelTargets.join(',')}`,
          `order after: ${rankedTargets.join(',')}`,
        ].join('\n'),
      );
    }

    for (const target of rankedTargets) {
      const model = target.slice('openrouter:'.length);
      attemptedModels.add(model);
      if (!this.circuitBreaker.isAvailable(target)) {
        const state = this.circuitBreaker.getState(target);
        if (state.openedUntil) markCooldown(target, state.openedUntil, state.lastError);
        skippedModels += 1;
        continue;
      }

      if (DEBUG) console.log(`[OpenRouter] Trying model: ${model}`);
      const start = Date.now();

      try {
        const toolReply = await this.generateWithTools(request, model, messages);
        if (toolReply !== null) {
          const latencyMs = Date.now() - start;
          recordModelSuccess(model, latencyMs);
          recordHealthSuccess(target, latencyMs);
          this.circuitBreaker.recordSuccess(target);
          if (DEBUG) console.log(`[OpenRouter] Success with tools: ${model}`);
          return { replyText: toolReply, providerUsed: AIProviderName.OPENROUTER };
        }

        const completion = await this.client.chat.completions.create({ model, messages });
        const replyText = completion.choices[0]?.message?.content ?? '';
        const latencyMs = Date.now() - start;
        recordModelSuccess(model, latencyMs);
        recordHealthSuccess(target, latencyMs);
        this.circuitBreaker.recordSuccess(target);
        if (DEBUG) console.log(`[OpenRouter] Success: ${model}`);
        return { replyText, providerUsed: AIProviderName.OPENROUTER };
      } catch (err) {
        const status = getErrorStatus(err);
        const msg = err instanceof Error ? err.message : String(err);

        recordModelFailure(model);
        recordHealthFailure(target, err, isTransientAIError(err));
        this.circuitBreaker.recordFailure(target, err);
        const state = this.circuitBreaker.getState(target);
        if (state.isOpen && state.openedUntil) markCooldown(target, state.openedUntil, err);
        errors.push({ model, error: `${status ?? 'network'}: ${msg}` });

        if (DEBUG) {
          console.log(`[OpenRouter] Failed (${status ?? 'network'}): ${model}`);
          if (errors.length + skippedModels < this.models.length) {
            console.log('[OpenRouter] Trying next...');
          }
        }

        // OpenRouter often suggests replacement slug when a :free model is retired.
        const suggestedSlug = status === 404 ? extractSuggestedSlug(msg) : null;
        const canUseSuggestedSlug =
          suggestedSlug !== null &&
          (this.allowPaidFallback || suggestedSlug.endsWith(':free'));

        if (canUseSuggestedSlug && !attemptedModels.has(suggestedSlug!)) {
          const nextModel = suggestedSlug!;
          attemptedModels.add(nextModel);
          const suggestedTarget = `openrouter:${nextModel}`;

          if (DEBUG) {
            console.log(`[OpenRouter] Retrying with suggested slug: ${nextModel}`);
          }

          if (!this.circuitBreaker.isAvailable(suggestedTarget)) {
            const suggestedState = this.circuitBreaker.getState(suggestedTarget);
            if (suggestedState.openedUntil) {
              markCooldown(suggestedTarget, suggestedState.openedUntil, suggestedState.lastError);
            }
          } else {
            const suggestedStart = Date.now();
            try {
              const completion = await this.client.chat.completions.create({
                model: nextModel,
                messages,
              });
              const replyText = completion.choices[0]?.message?.content ?? '';
              const latencyMs = Date.now() - suggestedStart;
              recordModelSuccess(nextModel, latencyMs);
              recordHealthSuccess(suggestedTarget, latencyMs);
              this.circuitBreaker.recordSuccess(suggestedTarget);
              if (DEBUG) console.log(`[OpenRouter] Success via suggested slug: ${nextModel}`);
              return { replyText, providerUsed: AIProviderName.OPENROUTER };
            } catch (suggestedErr) {
              const suggestedStatus = getErrorStatus(suggestedErr);
              const suggestedMsg = suggestedErr instanceof Error ? suggestedErr.message : String(suggestedErr);

              recordModelFailure(nextModel);
              recordHealthFailure(suggestedTarget, suggestedErr, isTransientAIError(suggestedErr));
              this.circuitBreaker.recordFailure(suggestedTarget, suggestedErr);
              const suggestedState = this.circuitBreaker.getState(suggestedTarget);
              if (suggestedState.isOpen && suggestedState.openedUntil) {
                markCooldown(suggestedTarget, suggestedState.openedUntil, suggestedErr);
              }
              errors.push({
                model: nextModel,
                error: `${suggestedStatus ?? 'network'}: ${suggestedMsg}`,
              });
            }
          }
        }

        if (!isRetryable(err)) {
          throw new Error(`OpenRouter terminal error on ${model}: ${msg}`);
        }
      }
    }

    if (errors.length === 0 && skippedModels === this.models.length) {
      throw new Error('OpenRouter: all models are temporarily unavailable due to circuit breaker cooldown');
    }

    const summary = errors.map((e) => `  ${e.model} -> ${e.error}`).join('\n');
    if (DEBUG) console.log(`[OpenRouter] All models failed:\n${summary}`);
    throw new Error(`OpenRouter: all models failed:\n${summary}`);
  }

  private async generateWithTools(
    request: ChatRequest,
    model: string,
    messages: OpenRouterMessage[],
  ): Promise<string | null> {
    if (!request.tools || request.tools.length === 0 || request.hasImage) return null;

    const replyText = await runWithTools<OpenAICompatibleToolState, OpenRouterCompletion>({
      initialState: { messages },
      providerCall: (state) => this.client.chat.completions.create({
        model,
        messages: state.messages as OpenRouterMessage[],
        tools: state.tools,
      }),
      adapter: openAICompatibleToolAdapter as unknown as ToolProviderAdapter<
        OpenAICompatibleToolState,
        OpenRouterCompletion
      >,
      toolDefinitions: request.tools,
    });

    return replyText === TOOL_LOOP_FALLBACK_MESSAGE ? null : replyText;
  }
}
