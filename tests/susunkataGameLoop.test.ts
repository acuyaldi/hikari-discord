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
  const channel = {
    id: 'channel-1',
    send: async (payload: unknown) => {
      sentPayloads.push(payload);
      return {
        edit: async (editPayload: unknown) => {
          editedPayloads.push(editPayload);
        },
      };
    },
  };
  const client = {
    channels: {
      fetch: async (channelId: string) => (channelId === 'channel-1' ? channel : null),
    },
  };
  return { client, sentPayloads, editedPayloads };
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

  assert.equal(sentPayloads.length >= 2, true);
  assert.equal(getRoom('channel-1'), null);
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
