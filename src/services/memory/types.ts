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
 * Individual sub-scores that compose the final retrieval score.
 * All values are on a 0–100 scale before weighting, making them
 * comparable in debug output regardless of their config weight.
 */
export interface ScoreBreakdown {
  /** Points from keyword overlap with the user's prompt (0–100). */
  keyword: number;
  /** Memory importance as stored (0–100). */
  importance: number;
  /** Usage recency — decays by 5 pts/day since last injection (0–100). */
  usage: number;
  /** Detector's confidence that the fact is accurate (0–100). */
  confidence: number;
  /** Creation/update recency — decays by 2 pts/day (0–100). */
  recency: number;
}

/**
 * A `MemoryRow` enriched with scoring data computed by the retriever.
 * Keeps retrieval scores separate from the persisted row — never stored in the DB.
 */
export interface MemoryCandidate extends MemoryRow {
  /** Weighted composite of all sub-scores. */
  score: number;
  /** Per-factor breakdown for debugging and future retrieval improvements. */
  scoreBreakdown: ScoreBreakdown;
  /** Keywords from the prompt that matched this memory's text. */
  matchedKeywords: string[];
}

/**
 * The public shape returned by retrieveMemories().
 * Contains only what callers need — scoring internals stay in MemoryCandidate.
 */
export interface RetrievedMemory {
  text: string;
  score: number;
  category: MemoryCategory;
  importance: number;
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
