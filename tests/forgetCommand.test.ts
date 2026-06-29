import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ChatInputCommandInteraction, InteractionReplyOptions } from 'discord.js';

type ForgetCommand = typeof import('../src/commands/forget');
type MemoryService = typeof import('../src/services/memory/memoryService');

async function withForgetCommand(
  run: (forgetCommand: ForgetCommand, memoryService: MemoryService) => Promise<void>,
): Promise<void> {
  const originalCwd = process.cwd();
  const testDir = mkdtempSync(join(tmpdir(), 'hikari-forget-command-'));
  let sqlite: typeof import('../src/database/sqlite').default | null = null;
  process.chdir(testDir);

  try {
    const commandPath = require.resolve('../src/commands/forget');
    const servicePath = require.resolve('../src/services/memory/memoryService');
    const sqlitePath = require.resolve('../src/database/sqlite');

    delete require.cache[commandPath];
    delete require.cache[servicePath];
    delete require.cache[sqlitePath];

    const forgetCommand = require('../src/commands/forget') as ForgetCommand;
    const memoryService = require('../src/services/memory/memoryService') as MemoryService;
    sqlite = require('../src/database/sqlite').default as typeof import('../src/database/sqlite').default;

    await run(forgetCommand, memoryService);
  } finally {
    sqlite?.close();
    process.chdir(originalCwd);
  }
}

function createInteractionMock(userId: string, guildId: string | null, query: string | null) {
  let replyPayload: string | InteractionReplyOptions | null = null;

  const interaction = {
    user: { id: userId },
    guildId,
    options: {
      getString: (name: string, required?: boolean) => {
        assert.equal(name, 'query');
        assert.equal(required, true);
        return query;
      },
    },
    reply: async (payload: string | InteractionReplyOptions) => {
      replyPayload = payload;
    },
  } as unknown as ChatInputCommandInteraction;

  return {
    interaction,
    getReply: () => replyPayload,
  };
}

function replyContent(payload: string | InteractionReplyOptions | null): string {
  assert.notEqual(payload, null);
  const checkedPayload = payload as string | InteractionReplyOptions;
  return typeof checkedPayload === 'string' ? checkedPayload : checkedPayload.content ?? '';
}

test('/forget deletes a single clear text match ephemerally', async () => {
  await withForgetCommand(async (forgetCommand, memoryService) => {
    assert.equal(memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-1',
      category: 'hardware',
      memory: 'User memakai RTX 3060.',
      importance: 90,
      confidence: 100,
    }).success, true);

    const mock = createInteractionMock('user-1', 'guild-1', 'RTX 3060');
    await forgetCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /sudah Hikari hapus/i);

    const memories = memoryService.listMemories('user-1');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 0);
  });
});

test('/forget rejects invalid query ephemerally', async () => {
  await withForgetCommand(async (forgetCommand, memoryService) => {
    const mock = createInteractionMock('user-1', 'guild-1', ' x ');
    await forgetCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /terlalu pendek/i);

    const memories = memoryService.listMemories('user-1');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 0);
  });
});

test('/forget replies when no memory matches', async () => {
  await withForgetCommand(async (forgetCommand, memoryService) => {
    assert.equal(memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-1',
      category: 'profile',
      memory: 'User tinggal di Bandung.',
      importance: 90,
      confidence: 100,
    }).success, true);

    const mock = createInteractionMock('user-1', 'guild-1', 'Surabaya');
    await forgetCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /tidak menemukan/i);

    const memories = memoryService.listMemories('user-1');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 1);
  });
});

test('/forget does not delete when text match is ambiguous', async () => {
  await withForgetCommand(async (forgetCommand, memoryService) => {
    for (const memory of ['User memakai RTX 3060.', 'User ingin upgrade ke RTX 5080.']) {
      assert.equal(memoryService.saveMemory({
        userId: 'user-1',
        guildId: 'guild-1',
        category: 'hardware',
        memory,
        importance: 90,
        confidence: 100,
      }).success, true);
    }

    const mock = createInteractionMock('user-1', 'guild-1', 'RTX');
    await forgetCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /lebih spesifik/i);

    const memories = memoryService.listMemories('user-1');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 2);
  });
});

test('/forget cannot delete another user memory by id', async () => {
  await withForgetCommand(async (forgetCommand, memoryService) => {
    assert.equal(memoryService.saveMemory({
      userId: 'user-2',
      guildId: 'guild-1',
      category: 'hardware',
      memory: 'User lain memakai RTX 3060.',
      importance: 90,
      confidence: 100,
    }).success, true);
    const otherMemory = memoryService.listMemories('user-2');
    assert.equal(otherMemory.success, true);

    const mock = createInteractionMock('user-1', 'guild-1', String(otherMemory.data[0].id));
    await forgetCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /tidak menemukan/i);

    const memories = memoryService.listMemories('user-2');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 1);
  });
});

test('/forget cannot delete another guild memory by id', async () => {
  await withForgetCommand(async (forgetCommand, memoryService) => {
    assert.equal(memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-2',
      category: 'hardware',
      memory: 'User memakai RTX 3060 di server lain.',
      importance: 90,
      confidence: 100,
    }).success, true);
    const otherGuildMemory = memoryService.listMemories('user-1');
    assert.equal(otherGuildMemory.success, true);

    const mock = createInteractionMock('user-1', 'guild-1', String(otherGuildMemory.data[0].id));
    await forgetCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /tidak menemukan/i);

    const memories = memoryService.listMemories('user-1');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 1);
  });
});
