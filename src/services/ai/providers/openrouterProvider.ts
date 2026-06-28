import OpenAI from 'openai';
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from '../../../config/env';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';

const client = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

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

    const completion = await client.chat.completions.create({
      model: OPENROUTER_MODEL,
      messages,
    });

    const replyText = completion.choices[0].message.content ?? '';
    return { replyText, providerUsed: AIProviderName.OPENROUTER };
  }
}
