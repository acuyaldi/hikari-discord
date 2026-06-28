import type { MemoryCandidate, RetrievalStrategy } from '../types';

/**
 * Splits a user prompt into keywords suitable for memory matching.
 * Filters out short stop-words (≤ 3 characters) that rarely carry meaning.
 *
 * @example
 *   extractKeywords("What is my graphics card?")
 *   // → ["what", "graphics", "card"]
 */
export function extractKeywords(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3);
}

/**
 * Keyword-based retrieval strategy.
 *
 * Scores each memory candidate by keyword overlap, importance, usage, and
 * recency, then returns the top `limit` results.
 *
 * Full implementation is wired in memoryRetriever.ts (Task 3).
 * This object satisfies the RetrievalStrategy contract so the retriever can
 * reference it by interface — swapping to a semantic strategy later requires
 * only changing which strategy is passed in.
 */
export const keywordStrategy: RetrievalStrategy = {
  name: 'keyword',

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  retrieve(_userId: string, _prompt: string, _limit: number): Promise<MemoryCandidate[]> {
    // Implemented in Task 3 — memoryRetriever.ts calls this strategy.
    return Promise.resolve([]);
  },
};
