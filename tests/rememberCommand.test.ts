import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ChatInputCommandInteraction, InteractionReplyOptions } from 'discord.js';
import { MemorySource } from '../src/services/memory/types';

type RememberCommand = typeof import('../src/commands/remember');
type MemoryService = typeof import('../src/services/memory/memoryService');

async function withRememberCommand(
  run: (rememberCommand: RememberCommand, memoryService: MemoryService) => Promise<void>,
): Promise<void> {
  const originalCwd = process.cwd();
  const testDir = mkdtempSync(join(tmpdir(), 'hikari-remember-command-'));
  let sqlite: typeof import('../src/database/sqlite').default | null = null;
  process.chdir(testDir);

  try {
    const commandPath = require.resolve('../src/commands/remember');
    const servicePath = require.resolve('../src/services/memory/memoryService');
    const sqlitePath = require.resolve('../src/database/sqlite');

    delete require.cache[commandPath];
    delete require.cache[servicePath];
    delete require.cache[sqlitePath];

    const rememberCommand = require('../src/commands/remember') as RememberCommand;
    const memoryService = require('../src/services/memory/memoryService') as MemoryService;
    sqlite = require('../src/database/sqlite').default as typeof import('../src/database/sqlite').default;

    await run(rememberCommand, memoryService);
  } finally {
    sqlite?.close();
    process.chdir(originalCwd);
  }
}

function createInteractionMock(userId: string, guildId: string | null, memoryText: string | null) {
  let replyPayload: string | InteractionReplyOptions | null = null;

  const interaction = {
    user: { id: userId },
    guildId,
    options: {
      getString: (name: string, required?: boolean) => {
        assert.equal(name, 'memory');
        assert.equal(required, true);
        return memoryText;
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

test('/remember saves manual memory for the current user and guild', async () => {
  await withRememberCommand(async (rememberCommand, memoryService) => {
    const mock = createInteractionMock('user-1', 'guild-1', 'Aku suka TypeScript untuk project bot Discord.');

    await rememberCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /sudah Hikari simpan/i);

    const memories = memoryService.listMemories('user-1', 'other');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 1);
    assert.equal(memories.data[0].guild_id, 'guild-1');
    assert.equal(memories.data[0].memory, 'aku suka typescript untuk project bot discord');
    assert.equal(memories.data[0].importance, 90);
    assert.equal(memories.data[0].confidence, 100);
    assert.equal(memories.data[0].source, MemorySource.MANUAL);
  });
});

test('/remember rejects empty or too-short memory text ephemerally', async () => {
  await withRememberCommand(async (rememberCommand, memoryService) => {
    const mock = createInteractionMock('user-1', 'guild-1', '   ok   ');

    await rememberCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /terlalu pendek/i);

    const memories = memoryService.listMemories('user-1');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 0);
  });
});

test('/remember rejects memory text that is too long', async () => {
  await withRememberCommand(async (rememberCommand, memoryService) => {
    const mock = createInteractionMock('user-1', 'guild-1', 'x'.repeat(501));

    await rememberCommand.execute(mock.interaction, {} as never);

    const reply = mock.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /terlalu panjang/i);

    const memories = memoryService.listMemories('user-1');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 0);
  });
});

test('/remember does not create a duplicate row for the same memory', async () => {
  await withRememberCommand(async (rememberCommand, memoryService) => {
    const first = createInteractionMock('user-1', 'guild-1', 'Aku sedang membangun Hikari.');
    await rememberCommand.execute(first.interaction, {} as never);

    const second = createInteractionMock('user-1', 'guild-1', 'aku sedang membangun hikari');
    await rememberCommand.execute(second.interaction, {} as never);

    const reply = second.getReply();
    assert.equal(typeof reply, 'object');
    assert.equal((reply as InteractionReplyOptions).ephemeral, true);
    assert.match(replyContent(reply), /sudah tersimpan/i);

    const memories = memoryService.listMemories('user-1', 'other');
    assert.equal(memories.success, true);
    assert.equal(memories.data.length, 1);
  });
});
