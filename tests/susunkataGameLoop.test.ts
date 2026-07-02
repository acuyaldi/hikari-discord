/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  createRoom,
  getRoom,
  joinRoom,
  resetSusunKataRoomsForTest,
  startGame,
} from '../src/services/games/susunkata/roomManager';
import {
  handleSusunKataAnswerMessage,
  runGame,
} from '../src/services/games/susunkata/gameLoop';
import type { WordEntry } from '../src/services/games/susunkata/wordValidator';

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

function createClientHarness() {
  const sentPayloads: unknown[] = [];
  const editedPayloads: unknown[] = [];
  const deletedMessageIds: string[] = [];
  const messages = new Map<string, {
    id: string;
    edit: (payload: unknown) => Promise<void>;
    delete: () => Promise<void>;
  }>();
  let nextMessageNumber = 1;
  const channel = {
    id: 'channel-1',
    send: async (payload: unknown) => {
      sentPayloads.push(payload);
      const message = {
        id: `message-${nextMessageNumber++}`,
        edit: async (editPayload: unknown) => {
          editedPayloads.push(editPayload);
        },
        delete: async () => {
          deletedMessageIds.push(message.id);
        },
      };
      messages.set(message.id, message);
      return message;
    },
    messages: {
      fetch: async (messageId: string) => {
        const message = messages.get(messageId);
        if (!message) throw new Error('message not found');
        return message;
      },
    },
  };
  const client = {
    channels: {
      fetch: async (channelId: string) => (channelId === 'channel-1' ? channel : null),
    },
  };
  return { client, sentPayloads, editedPayloads, deletedMessageIds, messages };
}

function createClientHarnessWithOneDeleteFailure() {
  const sentPayloads: unknown[] = [];
  const editedPayloads: unknown[] = [];
  const attemptedDeleteIds: string[] = [];
  const deletedMessageIds: string[] = [];
  const messages = new Map<string, {
    id: string;
    edit: (payload: unknown) => Promise<void>;
    delete: () => Promise<void>;
  }>();
  let nextMessageNumber = 1;
  const channel = {
    id: 'channel-1',
    send: async (payload: unknown) => {
      sentPayloads.push(payload);
      const message = {
        id: `message-${nextMessageNumber++}`,
        edit: async (editPayload: unknown) => {
          editedPayloads.push(editPayload);
        },
        delete: async () => {
          attemptedDeleteIds.push(message.id);
          if (message.id === 'message-1') throw new Error('delete failed');
          deletedMessageIds.push(message.id);
        },
      };
      messages.set(message.id, message);
      return message;
    },
    messages: {
      fetch: async (messageId: string) => {
        const message = messages.get(messageId);
        if (!message) throw new Error('message not found');
        return message;
      },
    },
  };
  const client = {
    channels: {
      fetch: async (channelId: string) => (channelId === 'channel-1' ? channel : null),
    },
  };
  return { client, sentPayloads, editedPayloads, attemptedDeleteIds, deletedMessageIds };
}

function createAnswer(userId: string, content: string) {
  return {
    channel: { id: 'channel-1' },
    author: { id: userId, bot: false },
    content,
  };
}

async function waitForRoundHandler(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitForRoundIndex(channelId: string, roundIndex: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getRoom(channelId)?.currentRoundIndex === roundIndex) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test('runGame fetches the word batch once and persists final leaderboard points', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const { client } = createClientHarness();
  createRoom('channel-1', 'creator-1', 2);
  joinRoom('channel-1', 'user-2');
  startGame('channel-1');
  let wordFetches = 0;

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async () => {
      wordFetches += 1;
      return [
        { word: 'melati', clue: 'Bunga putih yang harum.' },
        { word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' },
      ];
    },
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
  });

  await waitForRoundHandler();
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await waitForRoundIndex('channel-1', 1);
  await handleSusunKataAnswerMessage(createAnswer('user-2', 'sepeda') as never);
  await game;

  const scores = db.prepare('SELECT user_id, points FROM trivia_scores ORDER BY user_id').all() as Array<{ user_id: string; points: number }>;
  assert.equal(wordFetches, 1);
  assert.deepEqual(scores, [
    { user_id: 'creator-1', points: 10 },
    { user_id: 'user-2', points: 10 },
  ]);
  assert.equal(getRoom('channel-1'), null);
  db.close();
});

test('runGame awards only the first correct answer in a near-simultaneous race', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const { client } = createClientHarness();
  createRoom('channel-1', 'creator-1', 1);
  joinRoom('channel-1', 'user-2');
  startGame('channel-1');

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async () => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
  });

  await waitForRoundHandler();
  const first = handleSusunKataAnswerMessage(createAnswer('user-2', 'melati') as never);
  const second = handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await Promise.all([first, second]);
  await game;

  const scores = db.prepare('SELECT user_id, points FROM trivia_scores ORDER BY points DESC, user_id').all() as Array<{ user_id: string; points: number }>;
  assert.deepEqual(scores, [{ user_id: 'user-2', points: 10 }]);
  db.close();
});

test('runGame timeout awards no points and still finishes cleanly', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const { client } = createClientHarness();
  createRoom('channel-1', 'creator-1', 1);
  startGame('channel-1');

  await runGame('channel-1', client as never, {
    db,
    getWords: async () => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 5,
    transitionDelayMs: 0,
  });

  const rows = db.prepare('SELECT * FROM trivia_scores').all();
  assert.equal(rows.length, 0);
  assert.equal(getRoom('channel-1'), null);
  db.close();
});

test('runGame proceeds with fewer valid words than requested rounds', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const { client, sentPayloads } = createClientHarness();
  createRoom('channel-1', 'creator-1', 3);
  startGame('channel-1');

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async () => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
  });

  await waitForRoundHandler();
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await game;

  assert.equal(sentPayloads.length, 2);
  assert.equal(getRoom('channel-1'), null);
  db.close();
});

test('runGame cleans up the room when final leaderboard write fails', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  const { client } = createClientHarness();
  createRoom('channel-1', 'creator-1', 1);
  startGame('channel-1');

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async (): Promise<WordEntry[]> => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
  });

  await waitForRoundHandler();
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await game;

  assert.equal(getRoom('channel-1'), null);
  db.close();
});

test('runGame sends one message per round, edits each round result, and sends a separate podium', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const { client, sentPayloads, editedPayloads } = createClientHarness();
  createRoom('channel-1', 'creator-1', 2);
  startGame('channel-1');

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async () => [
      { word: 'melati', clue: 'Bunga putih yang harum.' },
      { word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' },
    ],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
  });

  await waitForRoundHandler();
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await waitForRoundIndex('channel-1', 1);
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'sepeda') as never);
  await game;

  assert.equal(sentPayloads.length, 3);
  assert.equal(editedPayloads.length, 2);
  assert.equal(getRoom('channel-1'), null);
  db.close();
});

test('runGame frees the channel after the final round before slow finalization finishes', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  let podiumSendStarted = (): void => undefined;
  let releasePodiumSend = (): void => undefined;
  const podiumSendStartedPromise = new Promise<void>((resolve) => {
    podiumSendStarted = resolve;
  });
  const releasePodiumSendPromise = new Promise<void>((resolve) => {
    releasePodiumSend = resolve;
  });
  let sendCount = 0;
  const client = {
    channels: {
      fetch: async () => ({
        send: async () => {
          sendCount += 1;
          if (sendCount === 2) {
            podiumSendStarted?.();
            await releasePodiumSendPromise;
          }
          return {
            id: `message-${sendCount}`,
            edit: async () => undefined,
          };
        },
      }),
    },
  };
  createRoom('channel-1', 'creator-1', 1);
  startGame('channel-1');

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async (): Promise<WordEntry[]> => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
  });

  await waitForRoundHandler();
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await podiumSendStartedPromise;

  const replacement = createRoom('channel-1', 'creator-2', 1);

  releasePodiumSend();
  await game;

  assert.equal(getRoom('channel-1'), replacement);
  db.close();
});

test('runGame deletes tracked lobby, round, and podium messages after cleanup delay', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const { client, deletedMessageIds, messages } = createClientHarness();
  const room = createRoom('channel-1', 'creator-1', 1);
  messages.set('lobby-1', {
    id: 'lobby-1',
    edit: async () => undefined,
    delete: async () => {
      deletedMessageIds.push('lobby-1');
    },
  });
  (room as unknown as { sentMessageIds: string[] }).sentMessageIds = ['lobby-1'];
  startGame('channel-1');

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async (): Promise<WordEntry[]> => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
    cleanupDelayMs: 5,
  } as Parameters<typeof runGame>[2] & { cleanupDelayMs: number });

  await waitForRoundHandler();
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await game;
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(deletedMessageIds.sort(), ['lobby-1', 'message-1', 'message-2'].sort());
  assert.equal(getRoom('channel-1'), null);
  db.close();
});

test('runGame cleanup keeps deleting remaining messages after one delete failure', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const { client, attemptedDeleteIds, deletedMessageIds } = createClientHarnessWithOneDeleteFailure();
  createRoom('channel-1', 'creator-1', 1);
  startGame('channel-1');

  const game = runGame('channel-1', client as never, {
    db,
    getWords: async (): Promise<WordEntry[]> => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
    cleanupDelayMs: 5,
  } as Parameters<typeof runGame>[2] & { cleanupDelayMs: number });

  await waitForRoundHandler();
  await handleSusunKataAnswerMessage(createAnswer('creator-1', 'melati') as never);
  await game;
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(attemptedDeleteIds.sort(), ['message-1', 'message-2'].sort());
  assert.deepEqual(deletedMessageIds, ['message-2']);
  db.close();
});

test('runGame cleans up the room after a mid-game error', async () => {
  resetSusunKataRoomsForTest();
  const db = new Database(':memory:');
  createTriviaScoresTable(db);
  const client = {
    channels: {
      fetch: async () => ({
        send: async () => {
          throw new Error('discord unavailable');
        },
      }),
    },
  };
  createRoom('channel-1', 'creator-1', 1);
  startGame('channel-1');

  await runGame('channel-1', client as never, {
    db,
    getWords: async (): Promise<WordEntry[]> => [{ word: 'melati', clue: 'Bunga putih yang harum.' }],
    roundTimeoutMs: 100,
    transitionDelayMs: 0,
  });

  assert.equal(getRoom('channel-1'), null);
  db.close();
});
