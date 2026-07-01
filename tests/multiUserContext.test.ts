import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFinalContext } from '../src/services/context/contextBuilder';
import {
  buildMultiUserContext,
  clearChannelContext,
  recordChannelMessage,
} from '../src/services/context/multiUserContext';

test('message with no reply or mention adds no extra recent context', async () => {
  clearChannelContext('channel-basic');

  const context = await buildMultiUserContext({
    channelId: 'channel-basic',
    messageId: 'm1',
    authorId: 'alice',
    authorName: 'Alice',
    content: 'halo hikari',
    botUserId: 'hikari',
    mentions: [],
    hasReference: false,
  });

  assert.deepEqual(context.recentMessages, []);
  assert.equal(context.currentUserMessage, '@Alice: halo hikari');
});

test('replying to Hikari includes labeled reply context', async () => {
  clearChannelContext('channel-reply-hikari');

  const context = await buildMultiUserContext({
    channelId: 'channel-reply-hikari',
    messageId: 'm2',
    authorId: 'bob',
    authorName: 'Bob',
    content: 'maksudnya apa?',
    botUserId: 'hikari',
    mentions: [],
    hasReference: true,
    fetchReference: async () => ({
      id: 'h1',
      channelId: 'channel-reply-hikari',
      authorId: 'hikari',
      authorName: 'Hikari',
      role: 'assistant',
      content: 'Aku sarankan pakai Gemini.',
    }),
  });

  assert.equal(context.recentMessages.length, 1);
  assert.match(context.recentMessages[0].content, /\[Reply to @Hikari\]: Aku sarankan/);
});

test('replying to another user includes that user as reply context', async () => {
  clearChannelContext('channel-reply-user');

  const context = await buildMultiUserContext({
    channelId: 'channel-reply-user',
    messageId: 'm3',
    authorId: 'alice',
    authorName: 'Alice',
    content: 'Hikari, bener gak?',
    botUserId: 'hikari',
    mentions: [],
    hasReference: true,
    fetchReference: async () => ({
      id: 'u1',
      channelId: 'channel-reply-user',
      authorId: 'bob',
      authorName: 'Bob',
      role: 'user',
      content: 'Menurutku errornya dari token.',
    }),
  });

  assert.match(context.recentMessages[0].content, /\[Reply to @Bob\]: Menurutku errornya/);
});

test('mentioning another user includes their recent same-channel message within lookback', async () => {
  clearChannelContext('channel-mention');
  recordChannelMessage({
    id: 'old',
    channelId: 'channel-mention',
    authorId: 'charlie',
    authorName: 'Charlie',
    role: 'user',
    content: 'Aku tadi bilang pakai branch staging.',
  });

  const context = await buildMultiUserContext({
    channelId: 'channel-mention',
    messageId: 'm4',
    authorId: 'alice',
    authorName: 'Alice',
    content: '<@charlie> tadi bilang apa?',
    botUserId: 'hikari',
    mentions: [{ id: 'charlie', name: 'Charlie' }],
    hasReference: false,
    mentionLookback: 5,
  });

  assert.equal(context.mentionsDetected.length, 1);
  assert.match(context.recentMessages[0].content, /\[Mentioned: @Charlie\]: Aku tadi bilang/);
});

test('mentioned user missing from lookback does not crash or add context', async () => {
  clearChannelContext('channel-missing-mention');

  const context = await buildMultiUserContext({
    channelId: 'channel-missing-mention',
    messageId: 'm5',
    authorId: 'alice',
    authorName: 'Alice',
    content: '<@dana> tahu gak?',
    botUserId: 'hikari',
    mentions: [{ id: 'dana', name: 'Dana' }],
    hasReference: false,
    mentionLookback: 5,
  });

  assert.deepEqual(context.recentMessages, []);
  assert.deepEqual(context.mentionResolution, [{ name: 'Dana', found: false }]);
});

test('fetchReference failure does not crash and omits reply context', async () => {
  clearChannelContext('channel-deleted-reply');

  const context = await buildMultiUserContext({
    channelId: 'channel-deleted-reply',
    messageId: 'm6',
    authorId: 'alice',
    authorName: 'Alice',
    content: 'lanjutkan ini',
    botUserId: 'hikari',
    mentions: [],
    hasReference: true,
    fetchReference: async () => {
      throw new Error('deleted');
    },
  });

  assert.deepEqual(context.recentMessages, []);
  assert.equal(context.replyDetected, true);
  assert.equal(context.replyAuthorName, null);
});

test('channel recent messages keep distinct author labels in final context', () => {
  const context = buildFinalContext({
    systemPrompt: 'System',
    recentMessages: [
      { role: 'user', authorName: 'Alice', content: 'Aku pilih opsi A.' },
      { role: 'user', authorName: 'Bob', content: 'Aku pilih opsi B.' },
      { role: 'assistant', authorName: 'Hikari', content: 'Aku catat dua opsi.' },
    ],
    currentUserMessage: '@Charlie: mana yang benar?',
  });

  assert.match(context.finalPrompt, /@Alice: Aku pilih opsi A\./);
  assert.match(context.finalPrompt, /@Bob: Aku pilih opsi B\./);
  assert.match(context.finalPrompt, /@Hikari: Aku catat dua opsi\./);
});

test('reply and mention context is bounded and prioritized over older recent messages', async () => {
  clearChannelContext('channel-bounds');
  recordChannelMessage({
    id: 'old-1',
    channelId: 'channel-bounds',
    authorId: 'old',
    authorName: 'OldUser',
    role: 'user',
    content: 'x'.repeat(120),
  });
  recordChannelMessage({
    id: 'target',
    channelId: 'channel-bounds',
    authorId: 'bob',
    authorName: 'Bob',
    role: 'user',
    content: 'short relevant note',
  });

  const context = await buildMultiUserContext({
    channelId: 'channel-bounds',
    messageId: 'm7',
    authorId: 'alice',
    authorName: 'Alice',
    content: 'lihat catatan Bob',
    botUserId: 'hikari',
    mentions: [{ id: 'bob', name: 'Bob' }],
    hasReference: true,
    fetchReference: async () => ({
      id: 'reply',
      channelId: 'channel-bounds',
      authorId: 'hikari',
      authorName: 'Hikari',
      role: 'assistant',
      content: 'reply context wins',
    }),
    mentionLookback: 5,
    maxContextLength: 100,
  });

  const joined = context.recentMessages.map((message) => message.content).join('\n');
  assert.match(joined, /\[Reply to @Hikari\]/);
  assert.match(joined, /\[Mentioned: @Bob\]/);
  assert.doesNotMatch(joined, /x{20}/);
  assert.ok(joined.length <= 100);
});
