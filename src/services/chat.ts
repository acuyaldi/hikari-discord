import db from '../database/sqlite';
import { classifyTask } from '../ai/router';
import { baseSystemInstruction } from '../prompt/basePrompt';
import { buildMemoryContext } from './memory/memoryContext';
import { providerManager } from './ai/providerManager';
import { trimHistoryForContext } from './context/adaptiveHistory';
import { buildFinalContext } from './context/contextBuilder';
import { getSummary } from './summary/summaryService';
import { DEBUG_MEMORY, DEBUG_SUMMARY, TOOL_CALLING_ENABLED } from '../config/env';
import { AIProviderName, TaskType } from './ai/types';
import { getRegisteredTools } from './tools/toolRegistry';
import type { ChatRequest } from './ai/types';
import type { ChatMessage } from './context/contextBuilder';
import type { UserRow } from '../types';

function preferredProvidersForEngine(
  enginePref: string | null | undefined,
): AIProviderName[] | undefined {
  switch (enginePref) {
    case AIProviderName.GEMINI:
      return [
        AIProviderName.GEMINI,
        AIProviderName.OPENROUTER,
        AIProviderName.HUGGINGFACE,
        AIProviderName.GROQ,
      ];
    case AIProviderName.GROQ:
      return [
        AIProviderName.GROQ,
        AIProviderName.GEMINI,
        AIProviderName.OPENROUTER,
        AIProviderName.HUGGINGFACE,
      ];
    case AIProviderName.OPENROUTER:
      return [
        AIProviderName.OPENROUTER,
        AIProviderName.GEMINI,
        AIProviderName.HUGGINGFACE,
        AIProviderName.GROQ,
      ];
    case AIProviderName.HUGGINGFACE:
      return [
        AIProviderName.HUGGINGFACE,
        AIProviderName.GEMINI,
        AIProviderName.OPENROUTER,
        AIProviderName.GROQ,
      ];
    default:
      return undefined;
  }
}

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

  if (DEBUG_MEMORY) {
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

  const panggilan = userRow?.nickname ?? 'teman';
  const injectIdentity =
    panggilan !== 'teman'
      ? `[INFO USER: Nama panggilan pilihannya adalah "${panggilan}". Sapa dia dengan nama tersebut saat relevan.]\n\n`
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
    preferredProviders: preferredProvidersForEngine(enginePref),
    tools: TOOL_CALLING_ENABLED && !hasImage ? getRegisteredTools() : undefined,
  };

  const response = await providerManager.generate(chatRequest);

  if (response.earlyReply) {
    return { replyText: '', engineIndicator: '', earlyReply: response.earlyReply };
  }

  replyText = response.replyText;

  return { replyText, engineIndicator };
}
