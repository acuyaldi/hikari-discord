export const MEMORY_CONFIG = {
  /** Maximum number of memories returned by the retriever. */
  maxRetrieved: 5,
  /** Candidate pool fetched from the DB before scoring is applied. */
  candidatePoolSize: 20,
  /** Weight applied to keyword match score (0–100). */
  keywordWeight: 4,
  /** Weight applied to the memory's stored importance (0–100). */
  importanceWeight: 2,
  /** Weight applied to the detector's confidence score (0–100). */
  confidenceWeight: 1,
  /** Weight applied to the recency score (0–100). */
  recencyWeight: 0.5,
  /** Maximum tokens injected into the system prompt. Formatter stops when this is reached. */
  tokenBudget: 600,
} as const;
