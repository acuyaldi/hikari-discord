import { touchMemory } from './memoryService';
import { keywordStrategy } from './retrieval/keywordStrategy';
import { logRetrievalWithScores } from './memoryDebug';
import { MEMORY_CONFIG } from './memoryConfig';
import type { RetrievedMemory } from './types';

/**
 * Retrieves the most relevant memories for a user given the current prompt.
 *
 * Uses the keyword strategy by default. Swapping to a semantic or hybrid
 * strategy in the future only requires changing which strategy object is
 * referenced here — this function's signature stays the same.
 *
 * Side effects (non-blocking, errors suppressed by service layer):
 *  - Calls touchMemory() on every returned row to update last_used_at.
 *
 * @param userId - Discord user ID
 * @param prompt - The user's current message (used for keyword extraction)
 * @param limit  - Maximum number of memories to return (default: MEMORY_CONFIG.maxRetrieved)
 * @returns Scored memory objects, sorted by relevance descending
 */
export async function retrieveMemories(
  userId: string,
  prompt: string,
  limit: number = MEMORY_CONFIG.maxRetrieved,
): Promise<RetrievedMemory[]> {
  const candidates = await keywordStrategy.retrieve(userId, prompt, limit);
  if (candidates.length === 0) return [];

  for (const candidate of candidates) {
    touchMemory(candidate.id);
  }

  logRetrievalWithScores(candidates);

  return candidates.map((c) => ({
    text:       c.memory,
    score:      c.score,
    category:   c.category,
    importance: c.importance,
  }));
}
