/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';
import type { InteractionReplyOptions } from 'discord.js';

import { execute } from '../src/commands/susunkata';
import {
  createRoom,
  getRoom,
  resetSusunKataRoomsForTest,
} from '../src/services/games/susunkata/roomManager';

function createCommandInteraction(input: {
  userId?: string;
  rounds?: number | null;
  forceClear?: boolean;
  canManageGuild?: boolean;
}) {
  const replies: Array<InteractionReplyOptions> = [];
  const replyMessage = { id: 'lobby-message-1' };
  const interaction = {
    guildId: 'guild-1',
    channelId: 'channel-1',
    user: { id: input.userId ?? 'creator-1' },
    memberPermissions: {
      has: () => input.canManageGuild ?? false,
    },
    options: {
      getInteger: (name: string) => (name === 'rounds' ? input.rounds ?? null : null),
      getBoolean: (name: string) => (name === 'force_clear' ? input.forceClear ?? false : false),
    },
    reply: async (payload: InteractionReplyOptions) => {
      replies.push(payload);
    },
    fetchReply: async () => replyMessage,
  };

  return { interaction, replies };
}

test('susunkata tracks the lobby message id on the room', async () => {
  resetSusunKataRoomsForTest();
  const { interaction } = createCommandInteraction({
    rounds: 3,
  });

  await execute(interaction as never, {} as never);

  assert.deepEqual(
    (getRoom('channel-1') as unknown as { sentMessageIds: string[] }).sentMessageIds,
    ['lobby-message-1'],
  );
});

test('susunkata force_clear destroys a stuck room for a server manager', async () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);
  const { interaction, replies } = createCommandInteraction({
    forceClear: true,
    canManageGuild: true,
  });

  await execute(interaction as never, {} as never);

  assert.equal(getRoom('channel-1'), null);
  assert.match(String(replies[0]?.content), /dibersihkan|clear/i);
  assert.equal(replies[0]?.ephemeral, true);
});

test('susunkata force_clear rejects users without server management permission', async () => {
  resetSusunKataRoomsForTest();
  createRoom('channel-1', 'creator-1', 5);
  const { interaction, replies } = createCommandInteraction({
    forceClear: true,
    canManageGuild: false,
  });

  await execute(interaction as never, {} as never);

  assert.notEqual(getRoom('channel-1'), null);
  assert.match(String(replies[0]?.content), /izin|permission|manage/i);
  assert.equal(replies[0]?.ephemeral, true);
});
