import OpenAI from 'openai';
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from '../../../config/env';
import { getGroqHistory } from '../../chatMemory';
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

    const { channelId, dynamicSystemInstruction, finalPrompt } = request;

    const history = getGroqHistory(channelId, dynamicSystemInstruction);
    if (history[history.length - 1]?.content !== finalPrompt) {
      history.push({ role: 'user', content: finalPrompt });
    }

    const completion = await client.chat.completions.create({
      model: OPENROUTER_MODEL,
      messages: history,
    });

    const replyText = completion.choices[0].message.content ?? '';
    history.push({ role: 'assistant', content: replyText });

    return { replyText, providerUsed: AIProviderName.OPENROUTER };
  }
}
