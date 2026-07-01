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

db.prepare(`
  CREATE TABLE IF NOT EXISTS ww_games (
    guild_id                TEXT PRIMARY KEY,
    channel_id              TEXT NOT NULL,
    host_user_id            TEXT NOT NULL,
    phase                   TEXT NOT NULL,
    message_id              TEXT,
    day_message_id          TEXT,
    phase_started_at        INTEGER,
    registration_started_at INTEGER,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS ww_players (
    guild_id               TEXT NOT NULL,
    user_id                TEXT NOT NULL,
    role                   TEXT NOT NULL DEFAULT 'villager',
    is_alive               INTEGER NOT NULL DEFAULT 1,
    voted_for              TEXT,
    dm_channel_id          TEXT,
    night_target_user_id   TEXT,
    last_action_at         INTEGER,
    joined_at              INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_ww_players_guild
  ON ww_players(guild_id)
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_ww_players_role
  ON ww_players(guild_id, role, is_alive)
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS trivia_scores (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    points   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_trivia_scores_guild_points
  ON trivia_scores(guild_id, points DESC)
`).run();

db.pragma(`user_version = ${SCHEMA_VERSION}`);

export default db;
