import db from '../database/sqlite';
import groq from '../ai/groq';
import openai from '../ai/openai';
import { getBestEngine } from '../ai/router';
import { baseSystemInstruction } from '../prompt/basePrompt';
import { getGroqHistory } from './chatMemory';
import { buildMemoryContext } from './memory/memoryContext';
import { providerManager } from './ai/providerManager';
import { TaskType } from './ai/types';
import type { ChatRequest } from './ai/types';
import type { UserRow } from '../types';

export interface ChatOptions {
  userId: string;
  guildId: string | null;
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
  const { userId, guildId, channelId, promptText, hasImage, imageUrl } = options;

  const userRow = db
    .prepare('SELECT nickname, feedback_notes, engine_pref FROM user_memories WHERE user_id = ?')
    .get(userId) as UserRow | undefined;

  let dynamicSystemInstruction = baseSystemInstruction;
  if (userRow?.feedback_notes) {
    dynamicSystemInstruction += `\n[PERINTAH MUTLAK DARI USER YANG WAJIB KAMU PATUHI SAAT INI JUGA: ${userRow.feedback_notes}]`;
  }

  let memoryContext = '';
  const memoryStart = Date.now();
  try {
    memoryContext = await buildMemoryContext({ userId, guildId, prompt: promptText });
  } catch (memoryError) {
    console.error('Memory retrieval error (non-fatal):', memoryError);
  }
  const memoryLatency = Date.now() - memoryStart;
  dynamicSystemInstruction += memoryContext;

  if (process.env.DEBUG_MEMORY === 'true') {
    const retrieved = (memoryContext.match(/•/g) ?? []).length;
    console.log(
      `[Memory Context]\nRetrieved: ${retrieved}\nCharacters: ${memoryContext.length}\nLatency: ${memoryLatency} ms`,
    );
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

  const chatRequest: ChatRequest = {
    userId,
    guildId,
    channelId,
    promptText,
    identityPrefix: injectIdentity,
    finalPrompt,
    dynamicSystemInstruction,
    hasImage,
    imageUrl,
    taskType: TaskType.GENERAL, // placeholder — replaced in Task 5
  };

  try {
    const response = await providerManager.generate(chatRequest);
    replyText = response.replyText;
  } catch (geminiChatError) {
    console.error('Gemini Error, fallback ke Groq:', geminiChatError);
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

    try {
      const groqResponse = await groq.chat.completions.create({
        messages: history,
        model: 'llama-3.1-8b-instant',
        temperature: 0.9,
      });
      replyText = groqResponse.choices[0].message.content ?? '';
      history.push({ role: 'assistant', content: replyText });
    } catch (groqError) {
      console.error('Groq Error, fallback ke OpenAI:', groqError);

      if (!process.env.OPENAI_API_KEY) {
        throw groqError;
      }

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: dynamicSystemInstruction },
          { role: 'user', content: finalPrompt },
        ],
      });
      replyText = completion.choices[0].message.content ?? '';
    }
  }

  return { replyText, engineIndicator };
}
