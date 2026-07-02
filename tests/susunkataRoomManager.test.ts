/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRoom,
  destroyRoom,
  getRoom,
  joinRoom,
  resetSusunKataRoomsForTest,
  startGame,
} from '../src/services/games/susunkata/roomManager';

test('createRoom creates a waiting room and auto-joins the creator', () => {
  resetSusunKataRoomsForTest();

  const room = createRoom('channel-1', 'creator-1', 5);

  assert.equal(room.phase, 'waiting');
  assert.equal(room.creatorId, 'creator-1');
  assert.equal(room.players.has('creator-1'), true);
  assert.equal(room.rounds, 5);
  assert.deepEqual((room as { sentMessageIds?: string[] }).sentMessageIds, []);
});

test('createRoom rejects a second active room in the same channel', () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);

  assert.throws(() => createRoom('channel-1', 'creator-2', 5), /already exists/i);
});

test('createRoom rejects waiting and playing rooms but allows stale finished rooms', () => {
  resetSusunKataRoomsForTest();
  const waitingRoom = createRoom('channel-1', 'creator-1', 5, { roomTimeoutMs: 1_000 });

  assert.throws(() => createRoom('channel-1', 'creator-2', 5), /already exists/i);

  waitingRoom.phase = 'playing';
  assert.throws(() => createRoom('channel-1', 'creator-2', 5), /already exists/i);

  waitingRoom.phase = 'finished';
  const replacement = createRoom('channel-1', 'creator-2', 3, { roomTimeoutMs: 1_000 });

  assert.equal(replacement.creatorId, 'creator-2');
  assert.equal(replacement.rounds, 3);
  resetSusunKataRoomsForTest();
});

test('joinRoom adds players once while room is waiting', () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);

  joinRoom('channel-1', 'user-2');
  joinRoom('channel-1', 'user-2');

  assert.deepEqual(Array.from(getRoom('channel-1')!.players), ['creator-1', 'user-2']);
});

test('startGame transitions a waiting room to playing', () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);

  const room = startGame('channel-1');

  assert.equal(room.phase, 'playing');
});

test('destroyRoom frees the channel for another room', () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);

  destroyRoom('channel-1');
  createRoom('channel-1', 'creator-2', 3);

  assert.equal(getRoom('channel-1')?.creatorId, 'creator-2');
});

test('destroyRoom with an expected room does not delete a replacement room', () => {
  resetSusunKataRoomsForTest();
  const oldRoom = createRoom('channel-1', 'creator-1', 5);
  oldRoom.phase = 'finished';
  const replacement = createRoom('channel-1', 'creator-2', 3);

  destroyRoom('channel-1', oldRoom);

  assert.equal(getRoom('channel-1'), replacement);
});

test('waiting room auto-expires after inactivity', async () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5, { roomTimeoutMs: 10 });

  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(getRoom('channel-1'), null);
});
