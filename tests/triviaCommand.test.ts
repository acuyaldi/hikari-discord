import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  executeTrivia,
  generateTriviaQuestionWithRetry,
  resetTriviaRuntimeStateForTest,
} from '../src/commands/trivia';

type CollectorHandlers = {
  collect?: (interaction: MockButtonInteraction) => Promise<void>;
  end?: (_collected: unknown, reason: string) => Promise<void>;
};

interface CollectorOptions {
  filter?: (interaction: MockButtonInteraction) => boolean;
}

interface MockButtonInteraction {
  customId: string;
  user: { id: string };
  message: { id: string };
  reply: (payload: { content: string; ephemeral: boolean }) => Promise<void>;
}

function createTriviaScoresTable(db: Database.Database): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS trivia_scores (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      points   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `).run();
}

function createHarness(channelId = 'channel-1') {
  const handlers: CollectorHandlers = {};
  let collectorOptions: CollectorOptions = {};
  const messageId = `trivia-${channelId}`;
  const collector = {
    on: (event: 'collect' | 'end', callback: CollectorHandlers['collect'] | CollectorHandlers['end']) => {
      if (event === 'collect') handlers.collect = callback as CollectorHandlers['collect'];
      if (event === 'end') handlers.end = callback as CollectorHandlers['end'];
      return collector;
    },
    stop: (reason: string) => {
      void handlers.end?.([], reason);
    },
  };

  const message = {
    id: messageId,
    createMessageComponentCollector: (options?: CollectorOptions) => {
      collectorOptions = options ?? {};
      return collector;
    },
  };

  const editReplyPayloads: Array<unknown> = [];
  const followUps: Array<unknown> = [];
  const directReplies: Array<unknown> = [];

  const interaction = {
    guildId: 'guild-1',
    channelId,
    user: { id: 'host' },
    deferReply: async () => undefined,
    editReply: async (payload: unknown) => {
      editReplyPayloads.push(payload);
      return undefined;
    },
    fetchReply: async () => message,
    followUp: async (payload: unknown) => {
      followUps.push(payload);
      return undefined;
    },
    reply: async (payload: unknown) => {
      directReplies.push(payload);
      return undefined;
    },
  };

  return {
    interaction,
    editReplyPayloads,
    followUps,
    directReplies,
    emitCollect: async (button: MockButtonInteraction) => {
      if (collectorOptions.filter && !collectorOptions.filter(button)) return;
      await handlers.collect?.(button);
    },
    emitEnd: async (reason = 'time') => {
      await handlers.end?.([], reason);
    },
  };
}

function createButton(
  customId: string,
  userId: string,
  replies: Array<unknown>,
  messageId = 'trivia-channel-1',
): MockButtonInteraction {
  return {
    customId,
    user: { id: userId },
    message: { id: messageId },
    reply: async (payload) => {
      replies.push(payload);
    },
  };
}

test('trivia awards +10 points to the first correct answer', async () => {
  resetTriviaRuntimeStateForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);

  const harness = createHarness();
  await executeTrivia(harness.interaction as never, { db } as never, {
    questionCount: 1,
    generateQuestion: async () => ({
      kategori: 'Sains',
      soal: 'Planet merah?',
      pilihan: ['A. Mars', 'B. Venus', 'C. Jupiter', 'D. Saturnus'],
      jawaban_benar: 'A',
    }),
    nowMs: () => 1_700_000_000_000,
  });

  const buttonReplies: Array<unknown> = [];
  await new Promise((resolve) => setImmediate(resolve));
  await harness.emitCollect(createButton('trivia_A', 'user-1', buttonReplies, 'trivia-channel-1'));
  await new Promise((resolve) => setImmediate(resolve));

  const score = db
    .prepare('SELECT points FROM trivia_scores WHERE guild_id = ? AND user_id = ?')
    .get('guild-1', 'user-1') as { points: number } | undefined;

  assert.equal(score?.points, 10);
  assert.equal(harness.followUps.length >= 1, true);

  db.close();
});

test('trivia rejects second click from the same user', async () => {
  resetTriviaRuntimeStateForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);

  const harness = createHarness();
  await executeTrivia(harness.interaction as never, { db } as never, {
    questionCount: 1,
    generateQuestion: async () => ({
      kategori: 'Geografi',
      soal: 'Ibu kota Australia?',
      pilihan: ['A. Sydney', 'B. Canberra', 'C. Melbourne', 'D. Brisbane'],
      jawaban_benar: 'B',
    }),
  });

  const userReplies: Array<unknown> = [];
  await new Promise((resolve) => setImmediate(resolve));
  await harness.emitCollect(createButton('trivia_A', 'user-2', userReplies, 'trivia-channel-1'));
  await harness.emitCollect(createButton('trivia_B', 'user-2', userReplies, 'trivia-channel-1'));

  const secondReply = userReplies[1] as { content?: string } | undefined;
  assert.equal(secondReply?.content, 'Kamu sudah mengunci jawabanmu!');

  db.close();
});

test('trivia timeout shows correct answer follow-up', async () => {
  resetTriviaRuntimeStateForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);

  const harness = createHarness();
  await executeTrivia(harness.interaction as never, { db } as never, {
    questionCount: 1,
    generateQuestion: async () => ({
      kategori: 'Umum',
      soal: 'Monas di kota mana?',
      pilihan: ['A. Bandung', 'B. Surabaya', 'C. Yogyakarta', 'D. Jakarta'],
      jawaban_benar: 'D',
    }),
  });

  await new Promise((resolve) => setImmediate(resolve));
  await harness.emitEnd('time');

  const followUpContents = harness.followUps
    .map((payload) => (payload as { content?: string } | undefined)?.content ?? '')
    .join('\n');
  assert.match(followUpContents, /Ronde 1\/1 habis waktu\. Jawaban benar: \*\*D\*\*/);

  db.close();
});

test('trivia blocks overlapping rounds in the same channel', async () => {
  resetTriviaRuntimeStateForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);

  const first = createHarness('channel-shared');
  const second = createHarness('channel-shared');

  await executeTrivia(first.interaction as never, { db } as never, {
    questionCount: 1,
    generateQuestion: async () => ({
      kategori: 'Sains',
      soal: 'H2O itu?',
      pilihan: ['A. Garam', 'B. Air', 'C. Oksigen', 'D. Besi'],
      jawaban_benar: 'B',
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  await executeTrivia(second.interaction as never, { db } as never, {
    questionCount: 1,
    generateQuestion: async () => ({
      kategori: 'Sains',
      soal: 'dummy',
      pilihan: ['A. a', 'B. b', 'C. c', 'D. d'],
      jawaban_benar: 'A',
    }),
  });

  const blockedReply = second.directReplies[0] as { content?: string; ephemeral?: boolean } | undefined;
  assert.equal(blockedReply?.ephemeral, true);
  assert.match(blockedReply?.content ?? '', /ronde trivia aktif/i);

  await first.emitEnd('time');
  db.close();
});

test('trivia generation falls back to local question after retry failure', async () => {
  const question = await generateTriviaQuestionWithRetry(async () => {
    throw new Error('simulated ai outage');
  });

  assert.equal(typeof question.kategori, 'string');
  assert.equal(question.pilihan.length, 4);
  assert.equal(['A', 'B', 'C', 'D'].includes(question.jawaban_benar), true);
});

test('trivia collector ignores non-trivia or foreign-message interactions', async () => {
  resetTriviaRuntimeStateForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);

  const harness = createHarness();
  await executeTrivia(harness.interaction as never, { db } as never, {
    questionCount: 1,
    generateQuestion: async () => ({
      kategori: 'Sains',
      soal: 'Matahari adalah?',
      pilihan: ['A. Planet', 'B. Bintang', 'C. Satelit', 'D. Nebula'],
      jawaban_benar: 'B',
    }),
  });

  const replies: Array<unknown> = [];
  await new Promise((resolve) => setImmediate(resolve));
  await harness.emitCollect(createButton('not_trivia', 'user-x', replies, 'trivia-channel-1'));
  await harness.emitCollect(createButton('trivia_B', 'user-x', replies, 'other-message'));

  const score = db
    .prepare('SELECT points FROM trivia_scores WHERE guild_id = ? AND user_id = ?')
    .get('guild-1', 'user-x') as { points: number } | undefined;

  assert.equal(score, undefined);
  assert.equal(replies.length, 0);
  await harness.emitEnd('time');
  db.close();
});
