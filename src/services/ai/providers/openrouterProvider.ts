import OpenAI from 'openai';
import { OPENROUTER_API_KEY, OPENROUTER_MODELS } from '../../../config/env';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';
import { recordModelSuccess, recordModelFailure } from '../providerMetrics';

const client = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const DEBUG = process.env.DEBUG_AI === 'true';

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    const s = err.status;
    if (s === 400 || s === 401 || s === 403) return false;
    if (s === 429 || s >= 500) return true;
  }
  return true;
}

export class OpenRouterProvider implements AIProvider {
  readonly name = AIProviderName.OPENROUTER;
  readonly supportsVision = false;
  readonly supportsReasoning = false;
  readonly supportsCoding = true;

  async generate(request: ChatRequest): Promise<ChatResponse> {
    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not configured');

    const { dynamicSystemInstruction, finalPrompt } = request;
    const messages: { role: 'system' | 'user'; content: string }[] = [
      { role: 'system', content: dynamicSystemInstruction },
      { role: 'user', content: finalPrompt },
    ];

    const errors: { model: string; error: string }[] = [];

    for (const model of OPENROUTER_MODELS) {
      if (DEBUG) console.log(`[OpenRouter] Trying model: ${model}`);
      const start = Date.now();

      try {
        const completion = await client.chat.completions.create({ model, messages });
        const replyText = completion.choices[0]?.message?.content ?? '';
        recordModelSuccess(model, Date.now() - start);
        if (DEBUG) console.log(`[OpenRouter] ✓ Success: ${model}`);
        return { replyText, providerUsed: AIProviderName.OPENROUTER };
      } catch (err) {
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        const msg = err instanceof Error ? err.message : String(err);

        recordModelFailure(model);
        errors.push({ model, error: `${status ?? 'network'}: ${msg}` });

        if (DEBUG) {
          console.log(`[OpenRouter] ✗ Failed (${status ?? 'network'}): ${model}`);
          if (errors.length < OPENROUTER_MODELS.length) console.log('[OpenRouter] Trying next...');
        }

        if (!isRetryable(err)) {
          throw new Error(`OpenRouter terminal error on ${model}: ${msg}`);
        }
      }
    }

    const summary = errors.map((e) => `  ${e.model} → ${e.error}`).join('\n');
    if (DEBUG) console.log(`[OpenRouter] All models failed:\n${summary}`);
    throw new Error(`OpenRouter: all models failed:\n${summary}`);
  }
}
