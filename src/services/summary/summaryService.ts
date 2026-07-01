import db from '../../database/sqlite';
import { logSummary } from './summaryDebug';
import { currentTimestamp, mapRow } from './summaryUtils';
import type { SummaryInput, SummaryResult, SummaryRow } from './types';

type SummaryUpdateFields = Partial<
  Pick<SummaryInput, 'summary' | 'messageCount' | 'lastMessageAt'>
>;

const stmts = {
  insert: db.prepare(`
    INSERT INTO conversation_summary
      (user_id, guild_id, summary, message_count, created_at, updated_at, last_message_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  updateFields: db.prepare(`
    UPDATE conversation_summary
    SET
      summary         = COALESCE(?, summary),
      message_count   = COALESCE(?, message_count),
      last_message_at = COALESCE(?, last_message_at),
      updated_at      = ?
    WHERE id = ?
  `),

  getById: db.prepare(`
    SELECT * FROM conversation_summary
    WHERE id = ?
    LIMIT 1
  `),

  getByUserGuild: db.prepare(`
    SELECT * FROM conversation_summary
    WHERE user_id = ?
      AND ((guild_id IS NULL AND ? IS NULL) OR guild_id = ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `),

  delete: db.prepare(`
    DELETE FROM conversation_summary
    WHERE id = ?
  `),

  incrementCount: db.prepare(`
    UPDATE conversation_summary
    SET
      message_count   = message_count + ?,
      last_message_at = ?,
      updated_at      = ?
    WHERE id = ?
  `),

  resetCount: db.prepare(`
    UPDATE conversation_summary
    SET
      message_count = 0,
      updated_at    = ?
    WHERE id = ?
  `),

  listByUser: db.prepare(`
    SELECT * FROM conversation_summary
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `),
};

function ok<T>(data: T): SummaryResult<T> {
  return { success: true, data };
}

function fail<T>(error: unknown): SummaryResult<T> {
  const message = error instanceof Error ? error.message : 'Unknown summary database error';
  return { success: false, error: message };
}

function getById(id: number): SummaryRow | null {
  const row = stmts.getById.get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

/** Creates a conversation summary row. */
export function createSummary(input: SummaryInput): SummaryResult<SummaryRow> {
  const now = currentTimestamp();
  const messageCount = input.messageCount ?? 0;
  const lastMessageAt = input.lastMessageAt ?? now;

  try {
    const result = stmts.insert.run(
      input.userId,
      input.guildId,
      input.summary,
      messageCount,
      now,
      now,
      lastMessageAt,
    );
    const row = getById(Number(result.lastInsertRowid));
    if (row === null) return fail(new Error('Created summary could not be loaded'));
    logSummary('createSummary', `id=${row.id}`);
    return ok(row);
  } catch (error) {
    return fail(error);
  }
}

/** Updates mutable fields on an existing summary row. */
export function updateSummary(
  id: number,
  fields: SummaryUpdateFields,
): SummaryResult<SummaryRow | null> {
  try {
    stmts.updateFields.run(
      fields.summary ?? null,
      fields.messageCount ?? null,
      fields.lastMessageAt ?? null,
      currentTimestamp(),
      id,
    );
    const row = getById(id);
    logSummary('updateSummary', `id=${id}`);
    return ok(row);
  } catch (error) {
    return fail(error);
  }
}

/** Gets the latest summary for a user and guild pair. */
export function getSummary(userId: string, guildId: string | null): SummaryResult<SummaryRow | null> {
  try {
    const row = stmts.getByUserGuild.get(userId, guildId, guildId) as
      | Record<string, unknown>
      | undefined;
    return ok(row ? mapRow(row) : null);
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a summary by id and returns whether a row was removed. */
export function deleteSummary(id: number): SummaryResult<boolean> {
  try {
    const result = stmts.delete.run(id);
    logSummary('deleteSummary', `id=${id}`);
    return ok(result.changes > 0);
  } catch (error) {
    return fail(error);
  }
}

/** Increments a summary message count and updates last_message_at. */
export function incrementMessageCount(
  id: number,
  amount = 1,
  lastMessageAt = currentTimestamp(),
): SummaryResult<SummaryRow | null> {
  try {
    const now = currentTimestamp();
    stmts.incrementCount.run(amount, lastMessageAt, now, id);
    const row = getById(id);
    logSummary('incrementMessageCount', `id=${id} amount=${amount}`);
    return ok(row);
  } catch (error) {
    return fail(error);
  }
}

/** Resets a summary message count to zero. */
export function resetMessageCount(id: number): SummaryResult<SummaryRow | null> {
  try {
    stmts.resetCount.run(currentTimestamp(), id);
    const row = getById(id);
    logSummary('resetMessageCount', `id=${id}`);
    return ok(row);
  } catch (error) {
    return fail(error);
  }
}

/** Lists all summaries for a user ordered by most recently updated. */
export function listSummaries(userId: string): SummaryResult<SummaryRow[]> {
  try {
    const rows = stmts.listByUser.all(userId) as Record<string, unknown>[];
    return ok(rows.map(mapRow));
  } catch (error) {
    return fail(error);
  }
}
