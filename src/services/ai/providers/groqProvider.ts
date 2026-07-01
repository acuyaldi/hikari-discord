import groq from '../../../ai/groq';
import { getGroqHistory } from '../../chatMemory';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';

export class GroqProvider implements AIProvider {
  readonly name = AIProviderName.GROQ;
  readonly supportsVision = false;
  readonly supportsReasoning = false;
  readonly supportsCoding = true;

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const { channelId, dynamicSystemInstruction, finalPrompt } = request;

    const history = getGroqHistory(channelId, dynamicSystemInstruction);

    if (history[history.length - 1]?.content !== finalPrompt) {
      history.push({ role: 'user', content: finalPrompt });
    }

    if (history.length > 25) {
      const coreTexts = history
        .slice(1, 15)
        .map((h) => `${h.role}: ${h.content}`)
        .join('\n');
      const summaryResponse = await groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: `Rangkum poin penting obrolan ini menjadi 3 kalimat:\n\n${coreTexts}`,
          },
        ],
        model: 'openai/gpt-oss-20b',
      });
      history.splice(1, 14, {
        role: 'system',
        content: `[SEJARAH KOMPRES: ${summaryResponse.choices[0].message.content}]`,
      });
    }

    const groqResponse = await groq.chat.completions.create({
      messages: history,
      model: 'openai/gpt-oss-20b',
      temperature: 0.9,
    });
    const replyText = groqResponse.choices[0].message.content ?? '';
    history.push({ role: 'assistant', content: replyText });

    return { replyText, providerUsed: AIProviderName.GROQ };
  }
}
