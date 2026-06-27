import Database from 'better-sqlite3';

const db = new Database('database.sqlite');

db.prepare(`
  CREATE TABLE IF NOT EXISTS user_memories (
    user_id TEXT PRIMARY KEY,
    nickname TEXT,
    feedback_notes TEXT,
    engine_pref TEXT DEFAULT 'gemini'
  )
`).run();

export default db;
