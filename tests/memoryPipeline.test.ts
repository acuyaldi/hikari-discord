import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { MemoryDecision } from '../src/services/memory/memoryDetector';

async function withMemoryPipeline(
  decision: MemoryDecision,
  run: (
    memoryService: typeof import('../src/services/memory/memoryService'),
    pipeline: typeof import('../src/services/memory/memoryPipeline'),
  ) => Promise<void>,
): Promise<void> {
  const originalCwd = process.cwd();
  const testDir = mkdtempSync(join(tmpdir(), 'hikari-memory-'));
  let sqlite: typeof import('../src/database/sqlite').default | null = null;
  process.chdir(testDir);

  try {
    const detectorPath = require.resolve('../src/services/memory/memoryDetector');
    const pipelinePath = require.resolve('../src/services/memory/memoryPipeline');
    const servicePath = require.resolve('../src/services/memory/memoryService');
    const sqlitePath = require.resolve('../src/database/sqlite');

    delete require.cache[detectorPath];
    delete require.cache[pipelinePath];
    delete require.cache[servicePath];
    delete require.cache[sqlitePath];

    require.cache[detectorPath] = {
      id: detectorPath,
      filename: detectorPath,
      loaded: true,
      exports: {
        detectMemory: async () => decision,
      },
    } as NodeJS.Module;

    const memoryService = require('../src/services/memory/memoryService') as typeof import('../src/services/memory/memoryService');
    const pipeline = require('../src/services/memory/memoryPipeline') as typeof import('../src/services/memory/memoryPipeline');
    sqlite = require('../src/database/sqlite').default as typeof import('../src/database/sqlite').default;

    await run(memoryService, pipeline);
  } finally {
    sqlite?.close();
    process.chdir(originalCwd);
  }
}

test('update decisions overwrite the matching older memory instead of inserting a duplicate', async () => {
  const updateDecision: MemoryDecision = {
    action: 'update',
    category: 'hardware',
    memory: 'User memakai VGA RTX 5080.',
    oldMemoryHint: 'VGA RTX 3060',
    importance: 90,
    confidence: 95,
  };

  await withMemoryPipeline(updateDecision, async (memoryService, pipeline) => {
    const seedResult = memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-1',
      category: 'hardware',
      memory: 'User memakai VGA RTX 3060.',
      importance: 90,
      confidence: 100,
    });
    assert.equal(seedResult.success, true);

    await pipeline.runMemoryPipeline('user-1', 'guild-1', 'sekarang aku pakai VGA RTX 5080');

    const memoriesResult = memoryService.listMemories('user-1', 'hardware');
    assert.equal(memoriesResult.success, true);
    assert.equal(memoriesResult.data.length, 1);
    assert.equal(memoriesResult.data[0].memory, 'user memakai vga rtx 5080');
  });
});

test('update decisions fall back to saving when the existing memory is a different fact', async () => {
  const updateDecision: MemoryDecision = {
    action: 'update',
    category: 'hardware',
    memory: 'User has a ThinkPad laptop.',
    importance: 80,
    confidence: 90,
  };

  await withMemoryPipeline(updateDecision, async (memoryService, pipeline) => {
    const seedResult = memoryService.saveMemory({
      userId: 'user-1',
      guildId: 'guild-1',
      category: 'hardware',
      memory: 'User memakai PC utama dengan RTX 3060.',
      importance: 90,
      confidence: 100,
    });
    assert.equal(seedResult.success, true);

    await pipeline.runMemoryPipeline('user-1', 'guild-1', 'aku juga punya laptop ThinkPad');

    const memoriesResult = memoryService.listMemories('user-1', 'hardware');
    assert.equal(memoriesResult.success, true);
    assert.equal(memoriesResult.data.length, 2);
    assert.deepEqual(
      memoriesResult.data.map((row) => row.memory).sort(),
      ['user has a thinkpad laptop', 'user memakai pc utama dengan rtx 3060'],
    );
  });
});
