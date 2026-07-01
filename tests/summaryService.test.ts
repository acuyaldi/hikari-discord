import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSummary,
  deleteSummary,
  getSummary,
  incrementMessageCount,
  listSummaries,
  resetMessageCount,
  updateSummary,
} from '../src/services/summary/summaryService';

const USER_ID = 'summary-test-user';
const GUILD_ID = 'summary-test-guild';

function assertOk<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) assert.fail(result.error);
  return result.data;
}

function cleanup(): void {
  const result = listSummaries(USER_ID);
  if (!result.success) return;

  for (const row of result.data) {
    deleteSummary(row.id);
  }
}

test('createSummary persists and returns a summary row', () => {
  cleanup();

  const row = assertOk(
    createSummary({
      userId: USER_ID,
      guildId: GUILD_ID,
      summary: 'User discussed TypeScript testing.',
      messageCount: 4,
      lastMessageAt: 1_700_000,
    }),
  );

  assert.equal(row.user_id, USER_ID);
  assert.equal(row.guild_id, GUILD_ID);
  assert.equal(row.summary, 'User discussed TypeScript testing.');
  assert.equal(row.message_count, 4);
  assert.equal(row.last_message_at, 1_700_000);
  assert.equal(typeof row.created_at, 'number');
  assert.equal(typeof row.updated_at, 'number');

  cleanup();
});

test('getSummary returns null for a missing summary', () => {
  cleanup();

  const row = assertOk(getSummary(USER_ID, GUILD_ID));

  assert.equal(row, null);
});

test('updateSummary changes fields and refreshes updated_at', () => {
  cleanup();
  const created = assertOk(
    createSummary({
      userId: USER_ID,
      guildId: GUILD_ID,
      summary: 'Initial summary.',
      messageCount: 2,
      lastMessageAt: 1_700_000,
    }),
  );

  const updated = assertOk(
    updateSummary(created.id, {
      summary: 'Updated summary.',
      messageCount: 9,
      lastMessageAt: 1_800_000,
    }),
  );

  assert.notEqual(updated, null);
  assert.equal(updated?.summary, 'Updated summary.');
  assert.equal(updated?.message_count, 9);
  assert.equal(updated?.last_message_at, 1_800_000);
  assert.ok((updated?.updated_at ?? 0) >= created.updated_at);

  cleanup();
});

test('deleteSummary removes a summary', () => {
  cleanup();
  const created = assertOk(
    createSummary({
      userId: USER_ID,
      guildId: GUILD_ID,
      summary: 'Delete me.',
    }),
  );

  assert.equal(assertOk(deleteSummary(created.id)), true);
  assert.equal(assertOk(getSummary(USER_ID, GUILD_ID)), null);
});

test('incrementMessageCount increments count and last message timestamp', () => {
  cleanup();
  const created = assertOk(
    createSummary({
      userId: USER_ID,
      guildId: GUILD_ID,
      summary: 'Count me.',
      messageCount: 1,
      lastMessageAt: 1_700_000,
    }),
  );

  const incremented = assertOk(incrementMessageCount(created.id, 3, 1_900_000));

  assert.notEqual(incremented, null);
  assert.equal(incremented?.message_count, 4);
  assert.equal(incremented?.last_message_at, 1_900_000);

  cleanup();
});

test('resetMessageCount resets count to zero', () => {
  cleanup();
  const created = assertOk(
    createSummary({
      userId: USER_ID,
      guildId: GUILD_ID,
      summary: 'Reset me.',
      messageCount: 7,
    }),
  );

  const reset = assertOk(resetMessageCount(created.id));

  assert.notEqual(reset, null);
  assert.equal(reset?.message_count, 0);

  cleanup();
});

test('listSummaries returns all summaries for a user ordered by updated time', () => {
  cleanup();
  const first = assertOk(createSummary({ userId: USER_ID, guildId: null, summary: 'First.' }));
  const second = assertOk(createSummary({ userId: USER_ID, guildId: GUILD_ID, summary: 'Second.' }));

  const summaries = assertOk(listSummaries(USER_ID));

  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries.map((row) => row.id).sort((left, right) => left - right),
    [first.id, second.id].sort((left, right) => left - right),
  );

  cleanup();
});
