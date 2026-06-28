import db from '../database/sqlite';
import { getBestEngine } from '../ai/router';
import { baseSystemInstruction } from '../prompt/basePrompt';
import { buildMemoryContext } from './memory/memoryContext';
import { providerManager } from './ai/providerManager';
import { AIProviderName, TaskType } from './ai/types';
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

  const response = await providerManager.generate(chatRequest);

  if (response.earlyReply) {
    return { replyText: '', engineIndicator: '', earlyReply: response.earlyReply };
  }

  replyText = response.replyText;

  if (response.providerUsed !== AIProviderName.GEMINI) {
    engineIndicator = '\n\n*(⚡ Hikari saat ini menggunakan otak cadangan: Groq Llama-3.1)*';
  }

  return { replyText, engineIndicator };
}
