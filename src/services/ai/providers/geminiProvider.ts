import ai from '../../../ai/gemini';
import groq from '../../../ai/groq';
import { DEBUG_AI } from '../../../config/env';
import { appendGeminiChatHistory, getGeminiChat, getGroqHistory } from '../../chatMemory';
import { downloadDiscordImage } from '../../../utils/downloadImage';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';
import {
  TOOL_LOOP_FALLBACK_MESSAGE,
  runWithTools,
} from '../../tools/toolExecutionLoop';
import { geminiToolAdapter } from '../../tools/providerAdapters/geminiToolAdapter';
import type { GeminiToolResponse, GeminiToolState } from '../../tools/providerAdapters/geminiToolAdapter';

export class GeminiProvider implements AIProvider {
  readonly name = AIProviderName.GEMINI;
  readonly supportsVision = true;
  readonly supportsReasoning = true;
  readonly supportsCoding = true;

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const {
      channelId,
      dynamicSystemInstruction,
      promptText,
      identityPrefix,
      finalPrompt,
      hasImage,
      imageUrl,
    } = request;

    let sendPrompt = finalPrompt;

    const lowPrompt = promptText.toLowerCase();
    const butuhInternet =
      !hasImage &&
      (lowPrompt.includes('hari ini') ||
        lowPrompt.includes('sekarang') ||
        lowPrompt.includes('berita') ||
        lowPrompt.includes('terbaru'));

    if (butuhInternet) {
      const searchResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: promptText,
        config: { tools: [{ googleSearch: {} }] },
      });
      sendPrompt =
        identityPrefix +
        `[INFO INTERNET TERBARU: ${searchResponse.text}]\n\nBerdasarkan info di atas, jawab dengan kreatif: ${promptText}`;
    }

    let messageContent: string | Array<string | { inlineData: { data: string; mimeType: string } }> =
      sendPrompt;

    if (hasImage && imageUrl) {
      try {
        messageContent = [sendPrompt, { inlineData: await downloadDiscordImage(imageUrl) }];
      } catch {
        messageContent =
          `[INFO SISTEM: Gambar gagal diproses, jadi jawab dari teks user saja dan jelaskan singkat bahwa gambar belum bisa dibaca saat ini.]\n\n${sendPrompt}`;
      }
    }

    const toolReply = typeof messageContent === 'string'
      ? await this.generateWithTools(request, messageContent)
      : null;
    if (toolReply !== null) {
      this.syncGeminiHistory(channelId, dynamicSystemInstruction, messageContent as string, toolReply);
      await this.syncGroqHistory(channelId, dynamicSystemInstruction, promptText, toolReply);
      return { replyText: toolReply, providerUsed: AIProviderName.GEMINI };
    }

    const response = await getGeminiChat(channelId, dynamicSystemInstruction).sendMessage({
      message: messageContent,
    });
    const replyText = response.text ?? '';

    // Keep Groq history in sync so the fallback has full conversation context.
    await this.syncGroqHistory(channelId, dynamicSystemInstruction, promptText, replyText);

    return { replyText, providerUsed: AIProviderName.GEMINI };
  }

  private async generateWithTools(
    request: ChatRequest,
    prompt: string,
  ): Promise<string | null> {
    if (!request.tools || request.tools.length === 0 || request.hasImage) return null;

    const replyText = await runWithTools<GeminiToolState, GeminiToolResponse>({
      initialState: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { systemInstruction: request.dynamicSystemInstruction },
      },
      providerCall: async (state) => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: state.contents as never,
        config: state.config,
      }) as Promise<GeminiToolResponse>,
      adapter: geminiToolAdapter,
      toolDefinitions: request.tools,
    });

    return replyText === TOOL_LOOP_FALLBACK_MESSAGE ? null : replyText;
  }

  private syncGeminiHistory(
    channelId: string,
    dynamicSystemInstruction: string,
    promptText: string,
    replyText: string,
  ): void {
    try {
      appendGeminiChatHistory(channelId, dynamicSystemInstruction, promptText, replyText);
    } catch (error) {
      if (DEBUG_AI) {
        console.error('[GeminiProvider] failed to sync tool reply into Gemini chat history:', error);
      }
    }
  }

  private async syncGroqHistory(
    channelId: string,
    dynamicSystemInstruction: string,
    promptText: string,
    replyText: string,
  ): Promise<void> {
    const groqHistory = getGroqHistory(channelId, dynamicSystemInstruction);
    groqHistory.push({ role: 'user', content: promptText });
    groqHistory.push({ role: 'assistant', content: replyText });

    if (groqHistory.length > 25) {
      console.log('Riwayat obrolan mulai kepanjangan, sedang dikompres...');
      const coreTexts = groqHistory
        .slice(1, 15)
        .map((h) => `${h.role}: ${h.content}`)
        .join('\n');
      const summaryResponse = await groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: `Rangkum poin-poin penting, sejarah emosi, dan inti dari obrolan ini menjadi 3 kalimat padat:\n\n${coreTexts}`,
          },
        ],
        model: 'openai/gpt-oss-20b',
      });
      groqHistory.splice(1, 14, {
        role: 'system',
        content: `[RANGKUMAN SEJARAH OBROLAN SEBELUMNYA: ${summaryResponse.choices[0].message.content}]`,
      });
    }
  }
}
