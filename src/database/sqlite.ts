import Database from 'better-sqlite3';

const db = new Database('database.sqlite');

// ── Existing table: user preferences (nickname, feedback, engine) ──────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS user_memories (
    user_id      TEXT PRIMARY KEY,
    nickname     TEXT,
    feedback_notes TEXT,
    engine_pref  TEXT DEFAULT 'gemini'
  )
`).run();

// ── Schema versioning for user_memory ────────────────────────────────────────
// Bump SCHEMA_VERSION whenever the user_memory table structure changes.
// On mismatch the table is dropped and recreated — safe during development
// when there is no production data to preserve.
//
//   v1 → initial table (Task 1, no UNIQUE constraint, single index)
//   v2 → UNIQUE(user_id, category, memory) + composite index (Task 1 patch)
const SCHEMA_VERSION = 2;
const currentVersion = db.pragma('user_version', { simple: true }) as number;

if (currentVersion < SCHEMA_VERSION) {
  db.prepare('DROP TABLE IF EXISTS user_memory').run();
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS user_memory (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT    NOT NULL,
    guild_id     TEXT,
    category     TEXT    NOT NULL,
    memory       TEXT    NOT NULL,
    importance   INTEGER DEFAULT 50,
    confidence   INTEGER DEFAULT 100,
    source       TEXT    DEFAULT 'chat',
    created_at   INTEGER,
    updated_at   INTEGER,
    last_used_at INTEGER,
    UNIQUE(user_id, category, memory)
  )
`).run();

// Single-column index: fast lookup for all memories of a user
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_user_memory_user
  ON user_memory(user_id)
`).run();

// Composite index: fast lookup when filtering by user + category
db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_user_memory_lookup
  ON user_memory(user_id, category)
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS conversation_summary (
    id              INTEGER PRIMARY KEY,
    user_id         TEXT    NOT NULL,
    guild_id        TEXT,
    summary         TEXT    NOT NULL,
    message_count   INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_conversation_summary_user
  ON conversation_summary(user_id)
`).run();

db.pragma(`user_version = ${SCHEMA_VERSION}`);

export default db;
