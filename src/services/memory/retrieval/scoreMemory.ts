import { MEMORY_CONFIG } from '../memoryConfig';
import type { MemoryCandidate, MemoryRow, ScoreBreakdown } from '../types';

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
 * Returns both the score and the list of keywords that matched.
 */
function computeKeywordScore(
  row: MemoryRow,
  keywords: string[],
): { score: number; matched: string[] } {
  if (keywords.length === 0) return { score: 0, matched: [] };
  const lower = row.memory.toLowerCase();
  const matched = keywords.filter((kw) => lower.includes(kw));
  return { score: Math.min(100, matched.length * 20), matched };
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
 * The composite score formula uses weights from MEMORY_CONFIG:
 *   keyword    × keywordWeight    (default 4)
 *   importance × importanceWeight (default 2)
 *   usage      × confidenceWeight (default 1)
 *   recency    × recencyWeight    (default 0.5)
 *
 * The confidence sub-score (row.confidence) is included in scoreBreakdown
 * for debugging visibility but does not contribute to the final score.
 * Tune weights in memoryConfig.ts without touching this function.
 */
export function scoreMemory(row: MemoryRow, ctx: ScoringContext): MemoryCandidate {
  const { score: keywordScore, matched: matchedKeywords } = computeKeywordScore(row, ctx.keywords);
  const importanceScore = computeImportanceScore(row);
  const usageScore      = computeUsageScore(row, ctx.now);
  const recencyScore    = computeRecencyScore(row, ctx.now);

  const score =
    keywordScore    * MEMORY_CONFIG.keywordWeight +
    importanceScore * MEMORY_CONFIG.importanceWeight +
    usageScore      * MEMORY_CONFIG.confidenceWeight +
    recencyScore    * MEMORY_CONFIG.recencyWeight;

  const scoreBreakdown: ScoreBreakdown = {
    keyword:    keywordScore,
    importance: importanceScore,
    usage:      usageScore,
    confidence: row.confidence,
    recency:    recencyScore,
  };

  return { ...row, score, scoreBreakdown, matchedKeywords };
}
