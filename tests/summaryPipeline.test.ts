import assert from 'node:assert/strict';
import test from 'node:test';

import { maybeRunSummaryPipeline, runSummaryPipeline } from '../src/services/summary/summaryPipeline';
import type { SummaryRow, SummaryResult } from '../src/services/summary/types';

function summaryRow(overrides: Partial<SummaryRow> = {}): SummaryRow {
  return {
    id: 1,
    user_id: 'user-1',
    guild_id: 'guild-1',
    summary: 'Existing summary.',
    message_count: 0,
    created_at: 1,
    updated_at: 1,
    last_message_at: 1,
    ...overrides,
  };
}

function ok<T>(data: T): SummaryResult<T> {
  return { success: true, data };
}

test('below threshold increments message count without generating', async () => {
  const calls: string[] = [];

  await runSummaryPipeline(
    {
      userId: 'user-1',
      guildId: 'guild-1',
      messageText: 'hello',
      recentMessages: ['hello'],
    },
    {
      triggerMessageCount: 3,
      getSummary: () => ok(summaryRow({ message_count: 1 })),
      createSummary: () => {
        throw new Error('should not create');
      },
      incrementMessageCount: () => ok(summaryRow({ message_count: 2 })),
      updateSummary: () => {
        calls.push('update');
        return ok(summaryRow());
      },
      resetMessageCount: () => {
        calls.push('reset');
        return ok(summaryRow());
      },
      generateSummary: async () => {
        calls.push('generate');
        return ok('Generated summary.');
      },
    },
  );

  assert.deepEqual(calls, []);
});

test('threshold triggers generation, update, and reset', async () => {
  const calls: string[] = [];

  await runSummaryPipeline(
    {
      userId: 'user-1',
      guildId: 'guild-1',
      messageText: 'latest',
      recentMessages: ['older', 'latest'],
    },
    {
      triggerMessageCount: 2,
      getSummary: () => ok(summaryRow({ message_count: 1 })),
      createSummary: () => {
        throw new Error('should not create');
      },
      incrementMessageCount: () => ok(summaryRow({ message_count: 2 })),
      updateSummary: (_id, fields) => {
        calls.push(`update:${fields.summary}`);
        return ok(summaryRow({ summary: fields.summary ?? '' }));
      },
      resetMessageCount: () => {
        calls.push('reset');
        return ok(summaryRow({ message_count: 0 }));
      },
      generateSummary: async ({ recentMessages }) => {
        calls.push(`generate:${recentMessages.join('|')}`);
        return ok('Generated summary.');
      },
    },
  );

  assert.deepEqual(calls, ['generate:older|latest', 'update:Generated summary.', 'reset']);
});

test('invalid generated summary is rejected and count is not reset', async () => {
  const calls: string[] = [];

  await runSummaryPipeline(
    {
      userId: 'user-1',
      guildId: 'guild-1',
      messageText: 'latest',
    },
    {
      triggerMessageCount: 1,
      getSummary: () => ok(summaryRow({ message_count: 0 })),
      createSummary: () => {
        throw new Error('should not create');
      },
      incrementMessageCount: () => ok(summaryRow({ message_count: 1 })),
      updateSummary: () => {
        calls.push('update');
        return ok(summaryRow());
      },
      resetMessageCount: () => {
        calls.push('reset');
        return ok(summaryRow());
      },
      generateSummary: async () => ({ success: false, error: 'Invalid summary' }),
    },
  );

  assert.deepEqual(calls, []);
});

test('missing summary row is created and can stay below threshold', async () => {
  const calls: string[] = [];

  await runSummaryPipeline(
    {
      userId: 'user-1',
      guildId: 'guild-1',
      messageText: 'first message',
    },
    {
      triggerMessageCount: 2,
      getSummary: () => ok(null),
      createSummary: () => {
        calls.push('create');
        return ok(summaryRow({ summary: '', message_count: 1 }));
      },
      incrementMessageCount: () => {
        throw new Error('should not increment missing row');
      },
      updateSummary: () => {
        calls.push('update');
        return ok(summaryRow());
      },
      resetMessageCount: () => {
        calls.push('reset');
        return ok(summaryRow());
      },
      generateSummary: async () => {
        calls.push('generate');
        return ok('Generated summary.');
      },
    },
  );

  assert.deepEqual(calls, ['create']);
});

test('pipeline errors are swallowed', async () => {
  await assert.doesNotReject(async () => {
    await runSummaryPipeline(
      {
        userId: 'user-1',
        guildId: 'guild-1',
        messageText: 'hello',
      },
      {
        getSummary: () => {
          throw new Error('database exploded');
        },
      },
    );
  });
});

test('maybeRunSummaryPipeline returns immediately for background execution', async () => {
  const started: string[] = [];
  const promise = maybeRunSummaryPipeline(
    {
      userId: 'user-1',
      guildId: 'guild-1',
      messageText: 'hello',
    },
    {
      getSummary: () => ok(summaryRow({ message_count: 0 })),
      incrementMessageCount: async () =>
        new Promise<SummaryResult<SummaryRow | null>>((resolve) => {
          started.push('increment-started');
          setTimeout(() => resolve(ok(summaryRow({ message_count: 1 }))), 50);
        }),
    },
  );

  assert.equal(promise, undefined);
  assert.deepEqual(started, []);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(started, ['increment-started']);
});
