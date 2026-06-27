import db from '../database/sqlite';
import ai from '../ai/gemini';
import groq from '../ai/groq';
import openai from '../ai/openai';
import { getBestEngine } from '../ai/router';
import { baseSystemInstruction } from '../prompt/basePrompt';
import { getGeminiChat, getGroqHistory } from './chatMemory';
import { downloadDiscordImage } from '../utils/downloadImage';
import type { UserRow } from '../types';

export interface ChatOptions {
  userId: string;
  channelId: string;
  promptText: string;
  hasImage: boolean;
  imageUrl?: string;
}

export interface ChatResult {
  replyText: string;
  engineIndicator: string;
  earlyReply?: string;
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const { userId, channelId, promptText, hasImage, imageUrl } = options;

  const userRow = db
    .prepare('SELECT nickname, feedback_notes, engine_pref FROM user_memories WHERE user_id = ?')
    .get(userId) as UserRow | undefined;

  let dynamicSystemInstruction = baseSystemInstruction;
  if (userRow?.feedback_notes) {
    dynamicSystemInstruction += `\n[PERINTAH MUTLAK DARI USER YANG WAJIB KAMU PATUHI SAAT INI JUGA: ${userRow.feedback_notes}]`;
  }

  const panggilan = userRow?.nickname ?? 'Senpai';
  const injectIdentity =
    panggilan !== 'Senpai'
      ? `[INFO USER: Nama panggilan kesayangannya adalah "${panggilan}". Selalu sapa dia dengan nama tersebut!]\n\n`
      : '';

  let finalPrompt = injectIdentity + promptText;
  let replyText = '';
  let engineIndicator = '';

  let engine = userRow?.engine_pref ?? 'gemini';
  if (engine === 'gemini' || engine === 'auto') {
    engine = await getBestEngine(promptText);
    console.log(`🤖 Hikari memilih otak: ${engine.toUpperCase()} untuk pertanyaan ini.`);
  }

  if (engine === 'openai') {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: dynamicSystemInstruction },
          { role: 'user', content: finalPrompt },
        ],
      });
      replyText = completion.choices[0].message.content ?? '';
    } catch (err) {
      console.error('OpenAI Error, fallback ke Groq:', err);
      const groqResponse = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: dynamicSystemInstruction },
          { role: 'user', content: finalPrompt },
        ],
        model: 'llama-3.1-8b-instant',
      });
      replyText =
        (groqResponse.choices[0].message.content ?? '') +
        ' *(Maaf Senpai, mode OpenAI sedang sibuk, Hikari pakai otak Groq dulu ya!)*';
    }
  } else {
    const lowPrompt = promptText.toLowerCase();
    const butuhInternet =
      !hasImage &&
      (lowPrompt.includes('hari ini') ||
        lowPrompt.includes('sekarang') ||
        lowPrompt.includes('berita') ||
        lowPrompt.includes('terbaru'));

    try {
      if (butuhInternet) {
        const searchResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: promptText,
          config: { tools: [{ googleSearch: {} }] },
        });
        finalPrompt =
          injectIdentity +
          `[INFO INTERNET TERBARU: ${searchResponse.text}]\n\nBerdasarkan info di atas, jawab dengan kreatif: ${promptText}`;
      }

      const messageContent =
        hasImage && imageUrl
          ? [finalPrompt, { inlineData: await downloadDiscordImage(imageUrl) }]
          : finalPrompt;

      const response = await getGeminiChat(channelId, dynamicSystemInstruction).sendMessage({
        message: messageContent,
      });
      replyText = response.text;

      const groqHistory = getGroqHistory(channelId, dynamicSystemInstruction);
      groqHistory.push({ role: 'user', content: promptText });
      groqHistory.push({ role: 'assistant', content: replyText });

      if (groqHistory.length > 25) {
        console.log('🧠 Sirkuit Konteks Penuh, Mengompres Riwayat Obrolan...');
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
          model: 'llama-3.1-8b-instant',
        });
        groqHistory.splice(1, 14, {
          role: 'system',
          content: `[RANGKUMAN SEJARAH OBROLAN SEBELUMNYA: ${summaryResponse.choices[0].message.content}]`,
        });
      }
    } catch (geminiChatError) {
      console.warn('⚠️ Sirkuit Gemini Limit! Mengalihkan ke Groq Llama 3.1...');
      engineIndicator = '\n\n*(⚡ Hikari saat ini menggunakan otak cadangan: Groq Llama-3.1)*';

      if (hasImage) {
        return {
          replyText: '',
          engineIndicator: '',
          earlyReply: 'Gomennasai Senpai... Sirkuit pembaca gambar Gemini sedang kelelahan! 🥺💢',
        };
      }

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
          model: 'llama-3.1-8b-instant',
        });
        history.splice(1, 14, {
          role: 'system',
          content: `[SEJARAH KOMPRES: ${summaryResponse.choices[0].message.content}]`,
        });
      }

      const groqResponse = await groq.chat.completions.create({
        messages: history,
        model: 'llama-3.1-8b-instant',
        temperature: 0.9,
      });
      replyText = groqResponse.choices[0].message.content ?? '';
      history.push({ role: 'assistant', content: replyText });
    }
  }

  return { replyText, engineIndicator };
}
