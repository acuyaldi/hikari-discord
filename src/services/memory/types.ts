/**
 * Where a memory came from.
 * Using an enum keeps values compile-time safe and prevents raw string literals
 * from scattering across the codebase.
 */
export enum MemorySource {
  CHAT       = 'chat',
  MANUAL     = 'manual',
  SYSTEM     = 'system',
  IMPORT     = 'import',
  KNOWLEDGE  = 'knowledge',
}

/** All valid categories a long-term memory can belong to. */
export type MemoryCategory =
  | 'profile'
  | 'preference'
  | 'hardware'
  | 'work'
  | 'education'
  | 'project'
  | 'hobby'
  | 'relationship'
  | 'other';

/** Mirrors a row in the `user_memory` SQLite table. */
export interface MemoryRow {
  id: number;
  user_id: string;
  guild_id: string | null;
  category: MemoryCategory;
  memory: string;
  importance: number;
  confidence: number;
  source: MemorySource;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

/**
 * A `MemoryRow` enriched with scoring data computed by the retriever.
 * Keeps retrieval scores separate from the persisted row — never stored in the DB.
 */
export interface MemoryCandidate extends MemoryRow {
  /** Weighted composite of the four sub-scores below. */
  score: number;
  /** Points earned from keyword overlap with the user's prompt (0–100). */
  keywordScore: number;
  /** Derived from the memory's importance field (0–100). */
  importanceScore: number;
  /** Based on how recently the memory was injected into a prompt (0–100). */
  usageScore: number;
  /** Based on how recently the memory was created or updated (0–100). */
  recencyScore: number;
}

/**
 * Contract that every retrieval strategy must implement.
 * Swapping strategies (keyword → semantic → hybrid) only requires
 * providing a new object that satisfies this interface.
 */
export interface RetrievalStrategy {
  /** Human-readable name used in debug logs. */
  name: string;
  retrieve(userId: string, prompt: string, limit: number): Promise<MemoryCandidate[]>;
}

/** Returned by the detector when a message contains a fact worth saving. */
export interface DetectedMemory {
  shouldRemember: true;
  category: MemoryCategory;
  memory: string;
  importance: number;
  confidence: number;
}

/** Returned by the detector when a message contains nothing worth saving. */
export interface NoMemory {
  shouldRemember: false;
}

/** Union of the two possible detector outcomes. */
export type DetectionResult = DetectedMemory | NoMemory;

/**
 * Standard result envelope used by every memoryService function.
 * Callers can discriminate on `success` without catching exceptions.
 */
export type Result<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Input object for saveMemory().
 *
 * Using an object instead of positional parameters means adding future fields
 * (e.g. language, provider) never requires updating every call site.
 */
export interface SaveMemoryInput {
  userId: string;
  guildId: string | null;
  category: MemoryCategory;
  memory: string;
  importance: number;
  confidence: number;
  /** Defaults to MemorySource.CHAT when omitted. */
  source?: MemorySource;
}
