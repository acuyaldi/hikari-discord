import groq from '../../../ai/groq';
import { getGroqHistory } from '../../chatMemory';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';
import {
  TOOL_LOOP_FALLBACK_MESSAGE,
  runWithTools,
} from '../../tools/toolExecutionLoop';
import { openAICompatibleToolAdapter } from '../../tools/providerAdapters/openaiCompatibleToolAdapter';
import { toolsForProvider } from '../../tools/providerToolSelection';

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

    const toolReply = await this.generateWithTools(request, history.map((message) => ({ ...message })));
    if (toolReply !== null) {
      history.push({ role: 'assistant', content: toolReply });
      return { replyText: toolReply, providerUsed: AIProviderName.GROQ };
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

  private async generateWithTools(
    request: ChatRequest,
    messages: Array<Record<string, unknown>>,
  ): Promise<string | null> {
    const tools = toolsForProvider(this.name, request.tools);
    if (tools.length === 0 || request.hasImage) return null;

    const replyText = await runWithTools({
      initialState: { messages },
      providerCall: (state) => groq.chat.completions.create({
        messages: state.messages as never,
        model: 'openai/gpt-oss-20b',
        temperature: 0.9,
        tools: state.tools as never,
      }),
      adapter: openAICompatibleToolAdapter,
      toolDefinitions: tools,
    });

    return replyText === TOOL_LOOP_FALLBACK_MESSAGE ? null : replyText;
  }
}
