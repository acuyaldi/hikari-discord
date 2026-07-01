import ai from '../../../ai/gemini';
import groq from '../../../ai/groq';
import { getGeminiChat, getGroqHistory } from '../../chatMemory';
import { downloadDiscordImage } from '../../../utils/downloadImage';
import { AIProviderName } from '../types';
import type { AIProvider, ChatRequest, ChatResponse } from '../types';

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

    const response = await getGeminiChat(channelId, dynamicSystemInstruction).sendMessage({
      message: messageContent,
    });
    const replyText = response.text ?? '';

    // Keep Groq history in sync so the fallback has full conversation context.
    const groqHistory = getGroqHistory(channelId, dynamicSystemInstruction);
    groqHistory.push({ role: 'user', content: promptText });
    groqHistory.push({ role: 'assistant', content: replyText });

    if (groqHistory.length > 25) {
      console.log('🧠 Riwayat obrolan mulai kepanjangan, sedang dikompres...');
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

    return { replyText, providerUsed: AIProviderName.GEMINI };
  }
}
