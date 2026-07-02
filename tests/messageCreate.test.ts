import assert from 'node:assert/strict';
import test from 'node:test';

import { SUMMARY_MAX_INPUT_MESSAGES } from '../src/config/env';
import {
  buildSummaryRecentMessages,
  registerMessageCreate,
} from '../src/events/messageCreate';
import type { ChannelContextMessage, MultiUserContextResult } from '../src/services/context/multiUserContext';
import type { Command } from '../src/types';

type MessageHandler = (message: never) => Promise<void>;

function createClientHarness() {
  let handler: MessageHandler | null = null;

  const client = {
    user: {
      id: 'hikari',
      username: 'Hikari',
    },
    on: (event: string, registeredHandler: MessageHandler) => {
      assert.equal(event, 'messageCreate');
      handler = registeredHandler;
    },
  };

  return {
    client,
    dispatch: async (message: never) => {
      assert.notEqual(handler, null);
      await handler!(message);
    },
  };
}

function createMessage(overrides: Record<string, unknown> = {}) {
  const channel = {
    id: 'channel-1',
    sendTyping: async () => undefined,
    send: async (payload: string) => payload,
  };

  return {
    id: 'message-1',
    content: '<@hikari> tolong rangkum ini',
    guildId: 'guild-1',
    author: {
      id: 'user-1',
      bot: false,
      username: 'Alice',
      globalName: 'Alice',
    },
    member: {
      displayName: 'Alice',
    },
    channel,
    mentions: {
      has: () => true,
      users: new Map(),
      members: new Map(),
    },
    attachments: new Map(),
    reference: null,
    reply: async (payload: string | { content: string }) => payload,
    fetchReference: async () => null,
    ...overrides,
  };
}

function multiUserContextResult(): MultiUserContextResult {
  return {
    recentMessages: [],
    currentUserMessage: '@Alice: tolong rangkum ini',
    replyDetected: false,
    replyAuthorName: null,
    mentionsDetected: [],
    mentionResolution: [],
  };
}

function transcriptMessage(
  overrides: Partial<ChannelContextMessage> = {},
): ChannelContextMessage {
  return {
    id: 't-1',
    channelId: 'channel-1',
    authorId: 'user-1',
    authorName: 'Alice',
    role: 'user',
    content: 'pesan',
    createdTimestamp: 1,
    ...overrides,
  };
}

test('buildSummaryRecentMessages uses labeled transcript messages when available', () => {
  const recentMessages = buildSummaryRecentMessages('channel-1', 'pesan terbaru', {
    maxInputMessages: 3,
    getTranscript: () => [
      transcriptMessage({ authorName: 'Alice', content: 'halo' }),
      transcriptMessage({ id: 't-2', authorName: 'Bob', content: 'pakai branch staging' }),
    ],
  });

  assert.deepEqual(recentMessages, [
    '@Alice: halo',
    '@Bob: pakai branch staging',
  ]);
});

test('buildSummaryRecentMessages falls back to the triggering message when transcript is empty', () => {
  const recentMessages = buildSummaryRecentMessages('channel-1', 'pesan terbaru', {
    maxInputMessages: 3,
    getTranscript: () => [],
  });

  assert.deepEqual(recentMessages, ['pesan terbaru']);
});

test('buildSummaryRecentMessages falls back to the triggering message when transcript lookup throws', () => {
  const recentMessages = buildSummaryRecentMessages('channel-1', 'pesan terbaru', {
    maxInputMessages: 3,
    getTranscript: () => {
      throw new Error('channel history unavailable');
    },
  });

  assert.deepEqual(recentMessages, ['pesan terbaru']);
});

test('registerMessageCreate passes multiple labeled summary messages into the summary pipeline', async () => {
  const harness = createClientHarness();
  const summaryInputs: Array<{ recentMessages?: string[] }> = [];
  let transcriptLimit: number | null = null;

  registerMessageCreate(harness.client as never, {
    claimMessageDelivery: () => true,
    checkCooldown: () => false,
    buildMultiUserContext: async () => multiUserContextResult(),
    chat: async () => ({
      replyText: 'Siap, aku rangkum.',
      engineIndicator: '',
    }),
    runMemoryPipeline: async () => undefined,
    maybeRunSummaryPipeline: (input: { recentMessages?: string[] }) => {
      summaryInputs.push(input);
    },
    getChannelTranscript: (_channelId: string, limit: number) => {
      transcriptLimit = limit;
      return [
        transcriptMessage({ authorName: 'Alice', content: 'tolong cek error ini' }),
        transcriptMessage({ id: 't-2', authorName: 'Bob', content: 'stack trace-nya ada di log' }),
      ];
    },
  });

  await harness.dispatch(createMessage() as never);

  assert.equal(transcriptLimit, SUMMARY_MAX_INPUT_MESSAGES);
  assert.deepEqual(summaryInputs[0]?.recentMessages, [
    '@Alice: tolong cek error ini',
    '@Bob: stack trace-nya ada di log',
  ]);
});

test('registerMessageCreate falls back to a single user message when transcript lookup fails', async () => {
  const harness = createClientHarness();
  const summaryInputs: Array<{ recentMessages?: string[] }> = [];

  registerMessageCreate(harness.client as never, {
    claimMessageDelivery: () => true,
    checkCooldown: () => false,
    buildMultiUserContext: async () => multiUserContextResult(),
    chat: async () => ({
      earlyReply: 'Aku cek dulu ya.',
      replyText: '',
      engineIndicator: '',
    }),
    maybeRunSummaryPipeline: (input: { recentMessages?: string[] }) => {
      summaryInputs.push(input);
    },
    getChannelTranscript: () => {
      throw new Error('boom');
    },
  });

  await harness.dispatch(createMessage() as never);

  assert.deepEqual(summaryInputs[0]?.recentMessages, ['tolong rangkum ini']);
});

test('registerMessageCreate ignores duplicate delivery of the same message id', async () => {
  const harness = createClientHarness();
  let chatCalls = 0;
  const replies: Array<string | { content: string }> = [];
  const message = createMessage({
    reply: async (payload: string | { content: string }) => {
      replies.push(payload);
      return payload;
    },
  });

  registerMessageCreate(harness.client as never, {
    claimMessageDelivery: () => true,
    checkCooldown: () => false,
    buildMultiUserContext: async () => multiUserContextResult(),
    chat: async () => {
      chatCalls += 1;
      return {
        replyText: 'sekali aja',
        engineIndicator: '',
      };
    },
    runMemoryPipeline: async () => undefined,
    maybeRunSummaryPipeline: () => undefined,
  });

  await harness.dispatch(message as never);
  await harness.dispatch(message as never);

  assert.equal(chatCalls, 1);
  assert.equal(replies.length, 1);
});

test('registerMessageCreate ignores rapid duplicate prompt with different message ids', async () => {
  const harness = createClientHarness();
  let chatCalls = 0;
  const replies: Array<string | { content: string }> = [];

  registerMessageCreate(harness.client as never, {
    claimMessageDelivery: () => true,
    checkCooldown: () => false,
    buildMultiUserContext: async () => multiUserContextResult(),
    chat: async () => {
      chatCalls += 1;
      return {
        replyText: 'cukup sekali',
        engineIndicator: '',
      };
    },
    runMemoryPipeline: async () => undefined,
    maybeRunSummaryPipeline: () => undefined,
  });

  const first = createMessage({
    id: 'message-1',
    reply: async (payload: string | { content: string }) => {
      replies.push(payload);
      return payload;
    },
  });
  const second = createMessage({
    id: 'message-2',
    reply: async (payload: string | { content: string }) => {
      replies.push(payload);
      return payload;
    },
  });

  await harness.dispatch(first as never);
  await harness.dispatch(second as never);

  assert.equal(chatCalls, 1);
  assert.equal(replies.length, 1);
});

test('registerMessageCreate intercepts active susunkata player answers before normal chat', async () => {
  const harness = createClientHarness();
  let chatCalls = 0;
  let answerCalls = 0;

  registerMessageCreate(harness.client as never, {
    handleSusunKataAnswer: async () => {
      answerCalls += 1;
      return true;
    },
    claimMessageDelivery: () => true,
    checkCooldown: () => false,
    buildMultiUserContext: async () => multiUserContextResult(),
    chat: async () => {
      chatCalls += 1;
      return {
        replyText: 'normal chat should not run',
        engineIndicator: '',
      };
    },
    runMemoryPipeline: async () => undefined,
    maybeRunSummaryPipeline: () => undefined,
  });

  await harness.dispatch(createMessage({
    content: 'melati',
    mentions: {
      has: () => false,
      users: new Map(),
      members: new Map(),
    },
  }) as never);

  assert.equal(answerCalls, 1);
  assert.equal(chatCalls, 0);
});

test('registerMessageCreate keeps normal behavior when susunkata does not intercept', async () => {
  const harness = createClientHarness();
  let chatCalls = 0;

  registerMessageCreate(harness.client as never, {
    handleSusunKataAnswer: async () => false,
    claimMessageDelivery: () => true,
    checkCooldown: () => false,
    buildMultiUserContext: async () => multiUserContextResult(),
    chat: async () => {
      chatCalls += 1;
      return {
        replyText: 'normal chat runs',
        engineIndicator: '',
      };
    },
    runMemoryPipeline: async () => undefined,
    maybeRunSummaryPipeline: () => undefined,
  });

  await harness.dispatch(createMessage() as never);

  assert.equal(chatCalls, 1);
});
