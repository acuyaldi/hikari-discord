import { retrieveMemories } from './memoryRetriever';
import { formatMemoryContext } from './memoryFormatter';
import { MEMORY_CONFIG } from './memoryConfig';

export interface MemoryContextInput {
  userId: string;
  /** Accepted for future guild-scoped retrieval; not yet used by the retriever. */
  guildId: string | null;
  prompt: string;
  /** Maximum memories to retrieve. Defaults to MEMORY_CONFIG.maxRetrieved. */
  maxMemories?: number;
  /** Token budget for the injected context. Defaults to MEMORY_CONFIG.tokenBudget. */
  tokenBudget?: number;
}

/**
 * Builds a ready-to-inject memory context string for the given user and prompt.
 *
 * Returns an empty string when no relevant memories exist, so callers can safely
 * append the result to any system instruction without an extra guard.
 *
 * `chat.ts` should only ever call this function — it must never interact with
 * retrieval, formatting, or ranking directly.
 *
 * @param input - userId, guildId, prompt, and optional maxMemories / tokenBudget overrides
 */
export async function buildMemoryContext(input: MemoryContextInput): Promise<string> {
  const {
    userId,
    prompt,
    maxMemories = MEMORY_CONFIG.maxRetrieved,
    tokenBudget = MEMORY_CONFIG.tokenBudget,
  } = input;

  const memories = await retrieveMemories(userId, prompt, maxMemories);
  const formatted = formatMemoryContext(memories, tokenBudget);

  if (!formatted) return '';

  return `\n\n[INFORMASI JANGKA PANJANG TENTANG USER INI:\n${formatted}\n]`;
}
