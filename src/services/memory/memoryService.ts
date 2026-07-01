/**
 * memoryService.ts
 *
 * Single source of truth for all user_memory database operations.
 * No other module may query user_memory directly.
 *
 * All public functions:
 *  - return Result<T> — never throw
 *  - use pre-prepared statements — never build SQL at call time
 *  - normalize memory text before any write or lookup
 */

import db from '../../database/sqlite';
import { normalizeMemory } from './memoryUtils';
import { logService } from './memoryDebug';
import { MemorySource } from './types';
import type { MemoryCategory, MemoryRow, Result, SaveMemoryInput } from './types';

// ── Prepared statements (initialized once at module load) ─────────────────────
// Grouping them here makes it easy to audit every SQL query in the service.

const stmts = {
  insert: db.prepare(`
    INSERT INTO user_memory
      (user_id, guild_id, category, memory, importance, confidence,
       source, created_at, updated_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `),

  // Used when a duplicate is found: refresh timestamps, keep the higher scores.
  // MAX() is a scalar expression — valid inside a SET clause in SQLite.
  updateOnDuplicate: db.prepare(`
    UPDATE user_memory
    SET
      updated_at   = ?,
      last_used_at = ?,
      importance   = MAX(importance, ?),
      confidence   = MAX(confidence, ?)
    WHERE user_id = ? AND category = ? AND memory = ?
  `),

  // COALESCE pattern: pass NULL for fields that should not change.
  // A single static statement covers every combination of optional fields.
  updateFields: db.prepare(`
    UPDATE user_memory
    SET
      updated_at = ?,
      memory     = COALESCE(?, memory),
      category   = COALESCE(?, category),
      importance = COALESCE(?, importance),
      confidence = COALESCE(?, confidence)
    WHERE id = ?
  `),

  delete: db.prepare(`DELETE FROM user_memory WHERE id = ?`),

  getById: db.prepare(`SELECT * FROM user_memory WHERE id = ? LIMIT 1`),

  getByContent: db.prepare(`
    SELECT * FROM user_memory
    WHERE user_id = ? AND category = ? AND memory = ?
    LIMIT 1
  `),

  // Uses idx_user_memory_user(user_id)
  listAll: db.prepare(`
    SELECT * FROM user_memory
    WHERE user_id = ?
    ORDER BY importance DESC, updated_at DESC
  `),

  // Uses idx_user_memory_lookup(user_id, category)
  listByCategory: db.prepare(`
    SELECT * FROM user_memory
    WHERE user_id = ? AND category = ?
    ORDER BY importance DESC, updated_at DESC
  `),

  // Retriever pool: top N by importance before keyword scoring is applied
  candidates: db.prepare(`
    SELECT * FROM user_memory
    WHERE user_id = ?
    ORDER BY importance DESC, updated_at DESC
    LIMIT ?
  `),

  touch: db.prepare(`
    UPDATE user_memory SET last_used_at = ? WHERE id = ?
  `),

  exists: db.prepare(`
    SELECT 1 FROM user_memory
    WHERE user_id = ? AND category = ? AND memory = ?
    LIMIT 1
  `),
};

// ── Private helpers ───────────────────────────────────────────────────────────

/** Converts a raw SQLite row (unknown fields) into a typed MemoryRow. */
function mapRowToMemory(row: Record<string, unknown>): MemoryRow {
  return {
    id:           row['id']           as number,
    user_id:      row['user_id']      as string,
    guild_id:     (row['guild_id']    as string | null) ?? null,
    category:     row['category']     as MemoryCategory,
    memory:       row['memory']       as string,
    importance:   row['importance']   as number,
    confidence:   row['confidence']   as number,
    source:       row['source']       as MemorySource,
    created_at:   row['created_at']   as number,
    updated_at:   row['updated_at']   as number,
    last_used_at: (row['last_used_at'] as number | null) ?? null,
  };
}

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function fail<T>(error: unknown): Result<T> {
  const message = error instanceof Error ? error.message : 'Unknown database error';
  return { success: false, error: message };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Saves a detected memory for a user.
 *
 * Workflow:
 *  1. normalize text
 *  2. check for existing row (existsMemory)
 *  3a. if found   → UPDATE timestamps and take the higher importance/confidence
 *  3b. if not found → INSERT new row
 *
 * The UNIQUE(user_id, category, memory) DB constraint acts as a final safety net
 * against concurrent writes that slip past the application-level check.
 *
 * @param input - All fields required to persist a memory (see SaveMemoryInput)
 */
export function saveMemory(input: SaveMemoryInput): Result<null> {
  const { userId, guildId, category, memory, importance, confidence, source = MemorySource.CHAT } = input;
  const now = Date.now();
  const normalizedText = normalizeMemory(memory);

  try {
    const existingRow = stmts.getByContent.get(
      userId,
      category,
      normalizedText,
    ) as Record<string, unknown> | undefined;

    if (existingRow) {
      stmts.updateOnDuplicate.run(
        now,
        now,
        importance,
        confidence,
        userId,
        category,
        normalizedText,
      );
      logService('saveMemory', `duplicate found — updated timestamps and scores for "${normalizedText.slice(0, 50)}"`);
      return ok(null);
    }

    stmts.insert.run(
      userId,
      guildId,
      category,
      normalizedText,
      importance,
      confidence,
      source,
      now,
      now,
    );
    logService('saveMemory', `saved "${normalizedText.slice(0, 50)}"`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

/**
 * Updates specific fields of an existing memory row by primary key.
 *
 * Uses a COALESCE prepared statement so that a single static SQL string handles
 * every combination of optional fields — no dynamic SQL is built at call time.
 * Fields omitted from `fields` are left unchanged. `updated_at` is always set.
 *
 * If `memory` is updated it is re-normalized before storage.
 *
 * @param id     - Primary key of the row to update
 * @param fields - Subset of columns to change
 */
export function updateMemory(
  id: number,
  fields: Partial<Pick<MemoryRow, 'memory' | 'category' | 'importance' | 'confidence'>>,
): Result<null> {
  const now = Date.now();

  try {
    stmts.updateFields.run(
      now,
      fields.memory     !== undefined ? normalizeMemory(fields.memory) : null,
      fields.category   !== undefined ? fields.category                : null,
      fields.importance !== undefined ? fields.importance              : null,
      fields.confidence !== undefined ? fields.confidence              : null,
      id,
    );
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

/**
 * Deletes a memory row by its primary key.
 *
 * @param id - Primary key of the row to delete
 */
export function deleteMemory(id: number): Result<null> {
  try {
    stmts.delete.run(id);
    logService('deleteMemory', `id=${id}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

/**
 * Returns a single memory row by its primary key.
 * `data` is `null` when no row exists with that ID.
 *
 * @param id - Primary key of the row to fetch
 */
export function getMemoryById(id: number): Result<MemoryRow | null> {
  try {
    const row = stmts.getById.get(id) as Record<string, unknown> | undefined;
    return ok(row ? mapRowToMemory(row) : null);
  } catch (err) {
    return fail(err);
  }
}

/**
 * Returns all memories for a user ordered by importance DESC, updated_at DESC.
 *
 * When `category` is provided the query uses the composite index
 * `idx_user_memory_lookup(user_id, category)`.
 *
 * @param userId   - Discord user ID
 * @param category - Optional filter; omit to return memories across all categories
 */
export function listMemories(userId: string, category?: MemoryCategory): Result<MemoryRow[]> {
  try {
    const rows = category !== undefined
      ? stmts.listByCategory.all(userId, category)
      : stmts.listAll.all(userId);

    return ok((rows as Record<string, unknown>[]).map(mapRowToMemory));
  } catch (err) {
    return fail(err);
  }
}

/**
 * Returns the top `limit` memories for a user ordered by importance DESC.
 *
 * Intended exclusively for use by memoryRetriever.ts, which applies keyword
 * scoring on top of this candidate pool.
 *
 * @param userId - Discord user ID
 * @param limit  - Maximum number of candidates to return (default 20)
 */
export function getRelevantCandidates(userId: string, limit = 20): Result<MemoryRow[]> {
  try {
    const rows = stmts.candidates.all(userId, limit) as Record<string, unknown>[];
    return ok(rows.map(mapRowToMemory));
  } catch (err) {
    return fail(err);
  }
}

/**
 * Updates `last_used_at` to the current timestamp for a given memory row.
 * Called by the retriever whenever a memory is injected into a prompt.
 *
 * @param id - Primary key of the memory that was used
 */
export function touchMemory(id: number): Result<null> {
  try {
    stmts.touch.run(Date.now(), id);
    logService('touchMemory', `id=${id}`);
    return ok(null);
  } catch (err) {
    return fail(err);
  }
}

/**
 * Returns `true` when a normalized memory already exists for the given user
 * and category. Used by `saveMemory` and available for external callers.
 *
 * The memory parameter is normalized internally.
 *
 * @param userId   - Discord user ID
 * @param category - Memory category
 * @param memory   - Raw or already-normalized memory text
 */
export function existsMemory(
  userId: string,
  category: MemoryCategory,
  memory: string,
): Result<boolean> {
  try {
    const row = stmts.exists.get(userId, category, normalizeMemory(memory));
    return ok(row !== undefined);
  } catch (err) {
    return fail(err);
  }
}
