import assert from 'node:assert/strict';
import test from 'node:test';

import db from '../src/database/sqlite';
import { AIProviderName } from '../src/services/ai/types';
import { providerManager } from '../src/services/ai/providerManager';
import { chat } from '../src/services/chat';
import { estimateContextTokens } from '../src/services/context/contextBuilder';
import {
  resolveHistoryWindow,
  trimHistoryForContext,
} from '../src/services/context/adaptiveHistory';
import { createSummary, deleteSummary } from '../src/services/summary/summaryService';
import type { ChatMessage } from '../src/services/context/contextBuilder';
import type { ChatRequest, ChatResponse } from '../src/services/ai/types';

function messages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index + 1}`,
  }));
}

test('no summary uses fallback window and reason', () => {
  const result = resolveHistoryWindow({
    hasSummary: false,
    totalAvailableMessages: messages(10),
    fallbackWindowSize: 4,
  });

  assert.equal(result.reason, 'no-summary-fallback');
  assert.equal(result.windowSizeUsed, 4);
  assert.deepEqual(
    result.messages.map((message) => message.content),
    ['message-7', 'message-8', 'message-9', 'message-10'],
  );
});

test('summary with small history keeps all messages', () => {
  const result = resolveHistoryWindow({
    hasSummary: true,
    totalAvailableMessages: messages(3),
    fallbackWindowSize: 2,
  });

  assert.equal(result.reason, 'below-threshold-no-trim');
  assert.equal(result.windowSizeUsed, 3);
  assert.equal(result.messages.length, 3);
});

test('summary with large history uses adaptive window', () => {
  const result = resolveHistoryWindow({
    hasSummary: true,
    totalAvailableMessages: messages(30),
    fallbackWindowSize: 25,
  });

  assert.equal(result.reason, 'adaptive-with-summary');
  assert.equal(result.windowSizeUsed, 20);
  assert.equal(result.messages.length, 20);
});

test('trimmed messages are the most recent ones', () => {
  const result = resolveHistoryWindow({
    hasSummary: true,
    totalAvailableMessages: messages(30),
    fallbackWindowSize: 25,
  });

  assert.equal(result.messages[0]?.content, 'message-11');
  assert.equal(result.messages[result.messages.length - 1]?.content, 'message-30');
});

test('empty history returns empty without throwing', () => {
  const result = trimHistoryForContext({
    hasSummary: true,
    totalAvailableMessages: [],
    fallbackWindowSize: 10,
  });

  assert.deepEqual(result, []);
});

test('internal error falls back to fallback window behavior', () => {
  const badMessages = {
    length: 30,
    slice: () => {
      throw new Error('bad slice');
    },
  } as unknown as ChatMessage[];

  const result = resolveHistoryWindow({
    hasSummary: true,
    totalAvailableMessages: badMessages,
    fallbackWindowSize: 5,
  });

  assert.equal(result.reason, 'no-summary-fallback');
  assert.equal(result.windowSizeUsed, 5);
  assert.deepEqual(result.messages, []);
});

test('adaptive history reduces estimated context tokens when summary exists', () => {
  const fullHistory = messages(30);
  const fullText = fullHistory.map((message) => message.content).join('\n');
  const trimmed = trimHistoryForContext({
    hasSummary: true,
    totalAvailableMessages: fullHistory,
    fallbackWindowSize: 30,
  });
  const trimmedText = trimmed.map((message) => message.content).join('\n');

  assert.ok(estimateContextTokens(trimmedText) < estimateContextTokens(fullText));
});

test('chat passes adaptive recent messages shape into ProviderManager request', async () => {
  const summary = createSummary({
    userId: 'adaptive-chat-user',
    guildId: 'adaptive-chat-guild',
    summary: 'Ringkasan sudah tersedia.',
    messageCount: 0,
  });
  assert.equal(summary.success, true);
  if (!summary.success) return;

  db.prepare('DELETE FROM user_memories WHERE user_id = ?').run('adaptive-chat-user');

  const originalGenerate = providerManager.generate.bind(providerManager);
  let capturedRequest: ChatRequest | null = null;
  providerManager.generate = async (request: ChatRequest): Promise<ChatResponse> => {
    capturedRequest = request;
    return {
      replyText: 'ok',
      providerUsed: AIProviderName.GEMINI,
    };
  };

  try {
    await chat({
      userId: 'adaptive-chat-user',
      guildId: 'adaptive-chat-guild',
      channelId: 'adaptive-chat-channel',
      promptText: 'current message',
      hasImage: false,
      recentMessages: messages(30),
    });
  } finally {
    providerManager.generate = originalGenerate;
    deleteSummary(summary.data.id);
  }

  const request = capturedRequest as ChatRequest | null;
  assert.notEqual(request, null);
  if (request === null) return;
  assert.match(request.finalPrompt, /message-11/);
  assert.match(request.finalPrompt, /message-30/);
  assert.doesNotMatch(request.finalPrompt, /message-10/);
});
