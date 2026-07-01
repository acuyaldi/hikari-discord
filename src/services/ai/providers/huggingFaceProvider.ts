import OpenAI from 'openai';
import {
  DEBUG_AI,
  HUGGINGFACE_API_KEY,
  HUGGINGFACE_MODELS,
} from '../../../config/env';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';
import {
  circuitBreaker as defaultCircuitBreaker,
  isTransientAIError,
  type CircuitBreaker,
} from '../circuitBreaker';
import { markCooldown, recordHealthFailure, recordHealthSuccess } from '../healthCache';
import { rankTargets } from '../providerRanking';

const DEBUG = DEBUG_AI;

type HuggingFaceMessage = { role: 'system' | 'user'; content: string };
type HuggingFaceCompletion = { choices: { message?: { content?: string | null } }[] };
type HuggingFaceCreateParams = { model: string; messages: HuggingFaceMessage[] };

interface HuggingFaceClient {
  chat: {
    completions: {
      create(params: HuggingFaceCreateParams): Promise<HuggingFaceCompletion>;
    };
  };
}

interface HuggingFaceProviderOptions {
  apiKey?: string;
  models?: string[];
  circuitBreaker?: CircuitBreaker;
  client?: HuggingFaceClient;
}

function getErrorStatus(err: unknown): number | undefined {
  if (err instanceof OpenAI.APIError) return err.status;
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === 400 || status === 401 || status === 403) return false;
    if (status === 429 || status >= 500) return true;
  }
  return true;
}

export class HuggingFaceProvider implements AIProvider {
  readonly name = AIProviderName.HUGGINGFACE;
  readonly supportsVision = false;
  readonly supportsReasoning = false;
  readonly supportsCoding = true;

  private readonly apiKey: string;
  private readonly models: string[];
  private readonly circuitBreaker: CircuitBreaker;
  private readonly client?: HuggingFaceClient;

  constructor(options: HuggingFaceProviderOptions = {}) {
    this.apiKey = options.apiKey ?? HUGGINGFACE_API_KEY;
    this.models = options.models ?? HUGGINGFACE_MODELS;
    this.circuitBreaker = options.circuitBreaker ?? defaultCircuitBreaker;
    this.client = options.client;
  }

  async generate(request: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) throw new Error('HUGGINGFACE_API_KEY not configured');

    const client =
      this.client ??
      ({
        chat: {
          completions: {
            create: async (params) => {
              const defaultClient = new OpenAI({
                apiKey: this.apiKey,
                baseURL: 'https://router.huggingface.co/v1',
              });
              return defaultClient.chat.completions.create(params);
            },
          },
        },
      } satisfies HuggingFaceClient);

    const { dynamicSystemInstruction, finalPrompt } = request;
    const messages: HuggingFaceMessage[] = [
      { role: 'system', content: dynamicSystemInstruction },
      { role: 'user', content: finalPrompt },
    ];

    const errors: { model: string; error: string }[] = [];
    let skippedModels = 0;

    const modelTargets = this.models.map((model) => `huggingface:${model}`);
    const rankedTargets = rankTargets(modelTargets);

    if (DEBUG) {
      console.log(
        [
          '[HuggingFace Ranking]',
          `order before: ${modelTargets.join(',')}`,
          `order after: ${rankedTargets.join(',')}`,
        ].join('\n'),
      );
    }

    for (const target of rankedTargets) {
      const model = target.slice('huggingface:'.length);

      if (!this.circuitBreaker.isAvailable(target)) {
        const state = this.circuitBreaker.getState(target);
        if (state.openedUntil) markCooldown(target, state.openedUntil, state.lastError);
        skippedModels += 1;
        continue;
      }

      if (DEBUG) console.log(`[HuggingFace] Trying model: ${model}`);
      const start = Date.now();

      try {
        const completion = await client.chat.completions.create({ model, messages });
        const replyText = completion.choices[0]?.message?.content ?? '';
        const latencyMs = Date.now() - start;

        recordHealthSuccess(target, latencyMs);
        this.circuitBreaker.recordSuccess(target);

        if (DEBUG) console.log(`[HuggingFace] Success: ${model}`);
        return { replyText, providerUsed: AIProviderName.HUGGINGFACE };
      } catch (err) {
        const status = getErrorStatus(err);
        const msg = err instanceof Error ? err.message : String(err);

        recordHealthFailure(target, err, isTransientAIError(err));
        this.circuitBreaker.recordFailure(target, err);
        const state = this.circuitBreaker.getState(target);
        if (state.isOpen && state.openedUntil) markCooldown(target, state.openedUntil, err);

        errors.push({ model, error: `${status ?? 'network'}: ${msg}` });

        if (DEBUG) {
          console.log(`[HuggingFace] Failed (${status ?? 'network'}): ${model}`);
          if (errors.length + skippedModels < this.models.length) {
            console.log('[HuggingFace] Trying next...');
          }
        }

        if (!isRetryable(err)) {
          throw new Error(`HuggingFace terminal error on ${model}: ${msg}`);
        }
      }
    }

    if (errors.length === 0 && skippedModels === this.models.length) {
      throw new Error('HuggingFace: all models are temporarily unavailable due to circuit breaker cooldown');
    }

    const summary = errors.map((entry) => `  ${entry.model} -> ${entry.error}`).join('\n');
    if (DEBUG) console.log(`[HuggingFace] All models failed:\n${summary}`);
    throw new Error(`HuggingFace: all models failed:\n${summary}`);
  }
}
