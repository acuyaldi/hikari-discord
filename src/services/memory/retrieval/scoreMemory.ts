import type { MemoryCandidate, MemoryRow } from '../types';

const ONE_DAY_MS = 86_400_000;

/** Context passed to scoreMemory() for each candidate. */
export interface ScoringContext {
  /** Keywords extracted from the user's prompt. */
  keywords: string[];
  /** Current timestamp (Date.now()), passed in to keep scoring pure and testable. */
  now: number;
}

// ── Sub-score functions (each returns 0–100) ──────────────────────────────────

/**
 * Awards points per keyword found in the memory text.
 * Each hit adds 20 points, capped at 100.
 */
function computeKeywordScore(row: MemoryRow, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lower = row.memory.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw)).length;
  return Math.min(100, hits * 20);
}

/**
 * Passes the stored importance value through directly (already 0–100).
 */
function computeImportanceScore(row: MemoryRow): number {
  return row.importance;
}

/**
 * Rewards memories that were recently retrieved and injected into a prompt.
 * Decays by 5 points per day; memories never used score 0.
 */
function computeUsageScore(row: MemoryRow, now: number): number {
  if (row.last_used_at === null) return 0;
  const daysSinceUse = (now - row.last_used_at) / ONE_DAY_MS;
  return Math.max(0, 100 - daysSinceUse * 5);
}

/**
 * Rewards memories that were recently created or updated.
 * Decays by 2 points per day.
 */
function computeRecencyScore(row: MemoryRow, now: number): number {
  const daysSinceUpdate = (now - row.updated_at) / ONE_DAY_MS;
  return Math.max(0, 100 - daysSinceUpdate * 2);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Converts a plain MemoryRow into a scored MemoryCandidate.
 *
 * Composite score weights:
 *   keyword    × 0.40  — relevance to the current prompt
 *   importance × 0.30  — author-assigned priority
 *   usage      × 0.20  — recency of retrieval
 *   recency    × 0.10  — recency of creation/update
 */
export function scoreMemory(row: MemoryRow, ctx: ScoringContext): MemoryCandidate {
  const keywordScore    = computeKeywordScore(row, ctx.keywords);
  const importanceScore = computeImportanceScore(row);
  const usageScore      = computeUsageScore(row, ctx.now);
  const recencyScore    = computeRecencyScore(row, ctx.now);

  const score =
    keywordScore    * 0.40 +
    importanceScore * 0.30 +
    usageScore      * 0.20 +
    recencyScore    * 0.10;

  return { ...row, score, keywordScore, importanceScore, usageScore, recencyScore };
}
