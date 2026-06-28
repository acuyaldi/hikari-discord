import { getRelevantCandidates } from '../memoryService';
import { MEMORY_CONFIG } from '../memoryConfig';
import { scoreMemory } from './scoreMemory';
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
 * Fetches a candidate pool from the DB, scores each row via scoreMemory(),
 * sorts by score descending, and returns the top `limit` results.
 *
 * Swapping to a semantic or hybrid strategy only requires providing a new
 * object that satisfies the RetrievalStrategy interface — the public API
 * (retrieveMemories) remains unchanged.
 */
export const keywordStrategy: RetrievalStrategy = {
  name: 'keyword',

  retrieve(userId: string, prompt: string, limit: number): Promise<MemoryCandidate[]> {
    const candidatesResult = getRelevantCandidates(userId, MEMORY_CONFIG.candidatePoolSize);
    if (!candidatesResult.success || candidatesResult.data.length === 0) {
      return Promise.resolve([]);
    }

    const keywords = extractKeywords(prompt);
    const now = Date.now();

    const scored = candidatesResult.data
      .map((row) => scoreMemory(row, { keywords, now }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return Promise.resolve(scored);
  },
};
