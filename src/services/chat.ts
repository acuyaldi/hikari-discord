import db from '../database/sqlite';
import { classifyTask } from '../ai/router';
import { baseSystemInstruction } from '../prompt/basePrompt';
import { buildMemoryContext } from './memory/memoryContext';
import { providerManager } from './ai/providerManager';
import { trimHistoryForContext } from './context/adaptiveHistory';
import { buildFinalContext } from './context/contextBuilder';
import { getSummary } from './summary/summaryService';
import { DEBUG_SUMMARY } from '../config/env';
import { AIProviderName, TaskType } from './ai/types';
import type { ChatRequest } from './ai/types';
import type { ChatMessage } from './context/contextBuilder';
import type { UserRow } from '../types';

export interface ChatOptions {
  userId: string;
  guildId: string | null;
  channelId: string;
  promptText: string;
  hasImage: boolean;
  imageUrl?: string;
  recentMessages?: ChatMessage[];
  currentUserMessage?: string;
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

  let dynamicPrompt = '';
  if (userRow?.feedback_notes) {
    dynamicPrompt += `[PERINTAH MUTLAK DARI USER YANG WAJIB KAMU PATUHI SAAT INI JUGA: ${userRow.feedback_notes}]`;
  }

  let memoryContext = '';
  const memoryStart = Date.now();
  try {
    memoryContext = await buildMemoryContext({ userId, guildId, prompt: promptText });
  } catch (memoryError) {
    console.error('Memory retrieval error (non-fatal):', memoryError);
  }
  const memoryLatency = Date.now() - memoryStart;

  if (process.env.DEBUG_MEMORY === 'true') {
    const retrieved = (memoryContext.match(/•/g) ?? []).length;
    console.log(
      `[Memory Context]\nRetrieved: ${retrieved}\nCharacters: ${memoryContext.length}\nLatency: ${memoryLatency} ms`,
    );
  }

  let conversationSummary: string | null = null;
  try {
    const summaryResult = getSummary(userId, guildId);
    if (summaryResult.success) {
      conversationSummary = summaryResult.data?.summary ?? null;
    } else if (DEBUG_SUMMARY) {
      console.error('[Context Builder]\nsummary retrieval failed:', summaryResult.error);
    }
  } catch (summaryError) {
    if (DEBUG_SUMMARY) {
      console.error('[Context Builder]\nsummary retrieval threw:', summaryError);
    }
  }

  const panggilan = userRow?.nickname ?? 'Senpai';
  const injectIdentity =
    panggilan !== 'Senpai'
      ? `[INFO USER: Nama panggilan kesayangannya adalah "${panggilan}". Selalu sapa dia dengan nama tersebut!]\n\n`
      : '';
  const totalAvailableMessages = options.recentMessages ?? [];
  const hasSummary =
    typeof conversationSummary === 'string' && conversationSummary.trim().length > 0;
  const recentMessages = trimHistoryForContext({
    hasSummary,
    totalAvailableMessages,
    fallbackWindowSize: totalAvailableMessages.length,
  });

  const finalContext = buildFinalContext({
    systemPrompt: baseSystemInstruction,
    dynamicPrompt,
    longTermMemory: memoryContext,
    conversationSummary,
    recentMessages,
    currentUserMessage: injectIdentity + (options.currentUserMessage ?? promptText),
  });
  const finalPrompt = finalContext.finalPrompt;
  const dynamicSystemInstruction = finalContext.dynamicSystemInstruction;
  let replyText = '';
  let engineIndicator = '';

  const enginePref = userRow?.engine_pref ?? 'gemini';
  const taskType = hasImage
    ? TaskType.VISION
    : enginePref === 'gemini' || enginePref === 'auto'
      ? classifyTask(promptText)
      : TaskType.GENERAL;
  console.log(`🤖 Hikari mengklasifikasi tugas: ${taskType.toUpperCase()}`);

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
    taskType,
  };

  const response = await providerManager.generate(chatRequest);

  if (response.earlyReply) {
    return { replyText: '', engineIndicator: '', earlyReply: response.earlyReply };
  }

  replyText = response.replyText;

  const fallbackLabels: Partial<Record<AIProviderName, string>> = {
    [AIProviderName.GROQ]: 'Groq Llama-3.1',
    [AIProviderName.OPENROUTER]: 'OpenRouter',
  };
  const fallbackLabel = fallbackLabels[response.providerUsed];
  if (fallbackLabel) {
    engineIndicator = `\n\n*(⚡ Hikari saat ini menggunakan otak cadangan: ${fallbackLabel})*`;
  }

  return { replyText, engineIndicator };
}
