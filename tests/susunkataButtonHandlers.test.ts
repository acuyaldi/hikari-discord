/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';
import type { InteractionReplyOptions } from 'discord.js';

import {
  buildSusunKataCancelId,
  buildSusunKataJoinId,
  buildSusunKataStartId,
} from '../src/services/games/susunkata/ids';
import { handleSusunKataComponentInteraction } from '../src/services/games/susunkata/buttonHandlers';
import {
  createRoom,
  getRoom,
  resetSusunKataRoomsForTest,
} from '../src/services/games/susunkata/roomManager';

function createButtonInteraction(customId: string, userId: string) {
  const replies: Array<InteractionReplyOptions> = [];
  const edits: Array<unknown> = [];
  const followUps: Array<InteractionReplyOptions> = [];
  const interaction = {
    customId,
    channelId: 'channel-1',
    user: { id: userId },
    isButton: () => true,
    reply: async (payload: InteractionReplyOptions) => {
      replies.push(payload);
    },
    deferUpdate: async () => undefined,
    editReply: async (payload: unknown) => {
      edits.push(payload);
    },
    followUp: async (payload: InteractionReplyOptions) => {
      followUps.push(payload);
    },
  };

  return { interaction, replies, edits, followUps };
}

test('join button adds the user and duplicate join does not duplicate player count', async () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);
  const first = createButtonInteraction(buildSusunKataJoinId('channel-1'), 'user-2');
  const second = createButtonInteraction(buildSusunKataJoinId('channel-1'), 'user-2');

  assert.equal(await handleSusunKataComponentInteraction(first.interaction as never), true);
  assert.equal(await handleSusunKataComponentInteraction(second.interaction as never), true);

  assert.deepEqual(Array.from(getRoom('channel-1')!.players), ['creator-1', 'user-2']);
  assert.equal(second.replies[0]?.ephemeral, true);
});

test('non-creator cannot start or cancel the room', async () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);
  const start = createButtonInteraction(buildSusunKataStartId('channel-1'), 'user-2');
  const cancel = createButtonInteraction(buildSusunKataCancelId('channel-1'), 'user-2');

  await handleSusunKataComponentInteraction(start.interaction as never);
  await handleSusunKataComponentInteraction(cancel.interaction as never);

  assert.equal(getRoom('channel-1')?.phase, 'waiting');
  assert.match(String(start.replies[0]?.content), /creator|host|pembuat/i);
  assert.match(String(cancel.replies[0]?.content), /creator|host|pembuat/i);
});

test('creator start transitions to playing and invokes the game loop', async () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);
  let runCalls = 0;
  const start = createButtonInteraction(buildSusunKataStartId('channel-1'), 'creator-1');

  await handleSusunKataComponentInteraction(start.interaction as never, {
    runGame: async () => {
      runCalls += 1;
    },
  });

  assert.equal(getRoom('channel-1')?.phase, 'playing');
  assert.equal(runCalls, 1);
});

test('creator cancel destroys the room', async () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);
  const cancel = createButtonInteraction(buildSusunKataCancelId('channel-1'), 'creator-1');

  await handleSusunKataComponentInteraction(cancel.interaction as never);

  assert.equal(getRoom('channel-1'), null);
});
