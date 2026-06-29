import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ChatInputCommandInteraction, InteractionReplyOptions } from 'discord.js';
import { MemorySource } from '../src/services/memory/types';

type MemoryCommand = typeof import('../src/commands/memory');
type MemoryService = typeof import('../src/services/memory/memoryService');

async function withMemoryCommand(
  run: (memoryCommand: MemoryCommand, memoryService: MemoryService) => Promise<void>,
): Promise<void> {
  const originalCwd = process.cwd();
  const testDir = mkdtempSync(join(tmpdir(), 'hikari-memory-command-'));
  let sqlite: typeof import('../src/database/sqlite').default | null = null;
  process.chdir(testDir);

  try {
    const commandPath = require.resolve('../src/commands/memory');
    const servicePath = require.resolve('../src/services/memory/memoryService');
    const sqlitePath = require.resolve('../src/database/sqlite');

    delete require.cache[commandPath];
    delete require.cache[servicePath];
    delete require.cache[sqlitePath];

    const memoryCommand = require('../src/commands/memory') as MemoryCommand;
    const memoryService = require('../src/services/memory/memoryService') as MemoryService;
    sqlite = require('../src/database/sqlite').default as typeof import('../src/database/sqlite').default;

    await run(memoryCommand, memoryService);
  } finally {
    sqlite?.close();
    process.chdir(originalCwd);
  }
}

function createInteractionMock(userId: string, guildId: string | null, subcommand = 'list') {
  let replyPayload: string | InteractionReplyOptions | null = null;

  const interaction = {
    user: { id: userId },
    guildId,
    options: {
      getSubcommand: () => subcommand,
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

test('/memory replies ephemerally when no guild memory exists', async () => {
  await withMemoryCommand(async (memoryCommand) => {
    const mock = createInteractionMock('user-1', 'guild-1');

    await memoryCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.equal(replyContent(reply), 'Aku belum punya memory tentang kamu di server ini.');
  });
});

test('/memory shows only the current guild memory with useful metadata and a safe limit', async () => {
  await withMemoryCommand(async (memoryCommand, memoryService) => {
    const otherGuildResult = memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-2',
      category: 'hardware',
      memory: 'User memakai RTX 3060 di server lain.',
      importance: 90,
      confidence: 100,
    });
    assert.equal(otherGuildResult.success, true);

    for (let i = 1; i <= 16; i += 1) {
      const saveResult = memoryService.saveMemory({
        userId: 'user-1',
        guildId: 'guild-1',
        category: i % 2 === 0 ? 'hardware' : 'profile',
        memory: `Guild current memory ${i}.`,
        importance: 50 + i,
        confidence: 90,
      });
      assert.equal(saveResult.success, true);
    }

    const mock = createInteractionMock('user-1', 'guild-1');
    await memoryCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    const content = replyContent(reply);

    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(content, /\*\*Memory Hikari tentang kamu\*\*/);
    assert.match(content, /guild current memory 16/);
    assert.match(content, /hardware|profile/);
    assert.match(content, /importance: 66/);
    assert.match(content, /updated:/);
    assert.doesNotMatch(content, /server lain/);
    assert.equal((content.match(/\n\d+\./g) ?? []).length, 15);
    assert.match(content, /Menampilkan 15 dari 16 memory/);
  });
});

test('/memory stats replies with empty state when the current guild has no memory', async () => {
  await withMemoryCommand(async (memoryCommand) => {
    const mock = createInteractionMock('user-1', 'guild-1', 'stats');

    await memoryCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.equal(replyContent(reply), 'Belum ada statistik karena memory kamu di server ini masih kosong.');
  });
});

test('/memory stats summarizes only the current user and guild memory', async () => {
  await withMemoryCommand(async (memoryCommand, memoryService) => {
    assert.equal(memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-1',
      category: 'hardware',
      memory: 'User memakai RTX 5080.',
      importance: 90,
      confidence: 100,
    }).success, true);
    assert.equal(memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-1',
      category: 'profile',
      memory: 'User tinggal di Bandung.',
      importance: 70,
      confidence: 80,
      source: MemorySource.MANUAL,
    }).success, true);
    assert.equal(memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-2',
      category: 'hardware',
      memory: 'Memory server lain.',
      importance: 100,
      confidence: 100,
    }).success, true);
    assert.equal(memoryService.saveMemory({
      userId: 'user-2',
      guildId: 'guild-1',
      category: 'work',
      memory: 'Memory user lain.',
      importance: 100,
      confidence: 100,
    }).success, true);

    const mock = createInteractionMock('user-1', 'guild-1', 'stats');
    await memoryCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    const content = replyContent(reply);

    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(content, /\*\*Statistik Memory Hikari\*\*/);
    assert.match(content, /Total memory: 2/);
    assert.match(content, /hardware: 1/);
    assert.match(content, /profile: 1/);
    assert.match(content, /Rata-rata importance: 80/);
    assert.match(content, /Rata-rata confidence: 90/);
    assert.match(content, /Source: chat: 1, manual: 1/);
    assert.match(content, /Newest updated:/);
    assert.match(content, /Oldest created:/);
    assert.doesNotMatch(content, /server lain/i);
    assert.doesNotMatch(content, /user lain/i);
  });
});
