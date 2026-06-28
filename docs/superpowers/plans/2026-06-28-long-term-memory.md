# Long-Term Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, SQLite-backed long-term memory so Hikari remembers important user facts across conversations and injects them into AI prompts.

**Architecture:** A new `user_memory` table is added to the existing `database.sqlite`. Before each AI call, up to 5 relevant memories are retrieved via keyword scoring and prepended to the system instruction. After each reply, Gemini asynchronously classifies the user message as memorable or not (JSON response) and upserts to the DB — the Discord reply is never blocked.

**Tech Stack:** better-sqlite3 (installed), @google/genai Gemini (installed), TypeScript strict mode.

## Global Constraints

- TypeScript strict mode — no `any` unless explicitly justified with a comment
- Do NOT change: basePrompt, deepPrompt, slash command names, DB filename (`database.sqlite`), existing SQL queries, existing Discord reply text, fallback behavior, engine selection logic, chatMemory behavior
- SQLite only — no embeddings, no vector databases, no external services
- Memory detection MUST be fire-and-forget — never delay or block a Discord reply
- If memory detection/saving fails, log the error and continue normally

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/database/sqlite.ts` | Modify | Add `user_memory` table + index |
| `src/services/memory/types.ts` | Create | `MemoryRow`, `DetectedMemory`, `NoMemory`, `DetectionResult`, `MemoryCategory` |
| `src/services/memory/memoryService.ts` | Create | CRUD: `saveMemory`, `getRelevantMemories`, `deleteMemory`, `updateMemory`, `listMemories` |
| `src/services/memory/memoryRetriever.ts` | Create | Keyword-scored retrieval (max 5 memories) |
| `src/services/memory/memoryDetector.ts` | Create | Gemini lightweight JSON prompt → `DetectionResult` |
| `src/services/chat.ts` | Modify | Add `guildId?`, retrieve memories before prompt, detect+save after reply |
| `src/events/messageCreate.ts` | Modify | Pass `guildId` to `chat()` |

---

### Task 1: Database schema + shared types

**Files:**
- Modify: `src/database/sqlite.ts`
- Create: `src/services/memory/types.ts`

**Interfaces:**
- Produces: `MemoryRow`, `DetectedMemory`, `NoMemory`, `DetectionResult`, `MemoryCategory` — consumed by all subsequent tasks

- [ ] **Step 1: Add `user_memory` table to `src/database/sqlite.ts`**

The file currently ends after the `user_memories` CREATE TABLE block. Append after `.run()`:

```typescript
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

db.prepare(`
  CREATE TABLE IF NOT EXISTS user_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    category TEXT,
    memory TEXT NOT NULL,
    importance INTEGER DEFAULT 50,
    created_at INTEGER,
    updated_at INTEGER
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_user_memory_user_id ON user_memory(user_id)
`).run();

export default db;
```

- [ ] **Step 2: Verify table exists**

```bash
npx ts-node --project tsconfig.json -e "import db from './src/database/sqlite'; console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());"
```

Expected output includes both `{ name: 'user_memories' }` and `{ name: 'user_memory' }`.

- [ ] **Step 3: Create `src/services/memory/types.ts`**

```typescript
export type MemoryCategory =
  | 'profile'
  | 'preference'
  | 'hardware'
  | 'work'
  | 'education'
  | 'hobby'
  | 'relationship'
  | 'project'
  | 'other';

export interface MemoryRow {
  id: number;
  user_id: string;
  guild_id: string | null;
  category: MemoryCategory | null;
  memory: string;
  importance: number;
  created_at: number;
  updated_at: number;
}

export interface DetectedMemory {
  shouldRemember: true;
  category: MemoryCategory;
  memory: string;
  importance: number;
}

export interface NoMemory {
  shouldRemember: false;
}

export type DetectionResult = DetectedMemory | NoMemory;
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/database/sqlite.ts src/services/memory/types.ts
git commit -m "feat(memory): add user_memory table and shared types"
```

---

### Task 2: memoryService.ts — CRUD layer

**Files:**
- Create: `src/services/memory/memoryService.ts`

**Interfaces:**
- Consumes: `MemoryRow`, `DetectedMemory` from `./types`; `db` from `../../database/sqlite`
- Produces:
  - `saveMemory(userId: string, guildId: string | null, detected: DetectedMemory): void`
  - `getRelevantMemories(userId: string, limit?: number): MemoryRow[]`
  - `deleteMemory(id: number): void`
  - `updateMemory(id: number, fields: Partial<Pick<MemoryRow, 'memory' | 'category' | 'importance'>>): void`
  - `listMemories(userId: string): MemoryRow[]`

- [ ] **Step 1: Create `src/services/memory/memoryService.ts`**

```typescript
import db from '../../database/sqlite';
import type { DetectedMemory, MemoryRow } from './types';

export function saveMemory(
  userId: string,
  guildId: string | null,
  detected: DetectedMemory,
): void {
  const now = Date.now();

  // Duplicate check: match on first 30 chars of the memory text
  const existing = db
    .prepare(
      `SELECT id, importance FROM user_memory
       WHERE user_id = ? AND memory LIKE ? LIMIT 1`,
    )
    .get(userId, `%${detected.memory.slice(0, 30)}%`) as
    | Pick<MemoryRow, 'id' | 'importance'>
    | undefined;

  if (existing) {
    const newImportance =
      detected.importance > existing.importance ? detected.importance : existing.importance;
    db.prepare(
      `UPDATE user_memory SET updated_at = ?, importance = ? WHERE id = ?`,
    ).run(now, newImportance, existing.id);
    console.log(`[Memory] Updated: "${detected.memory.slice(0, 60)}"`);
    return;
  }

  db.prepare(
    `INSERT INTO user_memory (user_id, guild_id, category, memory, importance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, guildId, detected.category, detected.memory, detected.importance, now, now);
  console.log(`[Memory] Saved: "${detected.memory.slice(0, 60)}"`);
}

export function getRelevantMemories(userId: string, limit = 5): MemoryRow[] {
  return db
    .prepare(
      `SELECT * FROM user_memory
       WHERE user_id = ?
       ORDER BY importance DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as MemoryRow[];
}

export function deleteMemory(id: number): void {
  db.prepare(`DELETE FROM user_memory WHERE id = ?`).run(id);
}

export function updateMemory(
  id: number,
  fields: Partial<Pick<MemoryRow, 'memory' | 'category' | 'importance'>>,
): void {
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (fields.memory !== undefined) {
    sets.push('memory = ?');
    values.push(fields.memory);
  }
  if (fields.category !== undefined) {
    sets.push('category = ?');
    values.push(fields.category);
  }
  if (fields.importance !== undefined) {
    sets.push('importance = ?');
    values.push(fields.importance);
  }

  values.push(id);
  db.prepare(`UPDATE user_memory SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function listMemories(userId: string): MemoryRow[] {
  return db
    .prepare(
      `SELECT * FROM user_memory
       WHERE user_id = ?
       ORDER BY importance DESC, updated_at DESC`,
    )
    .all(userId) as MemoryRow[];
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test CRUD**

```bash
npx ts-node --project tsconfig.json -e "
const { saveMemory, listMemories, deleteMemory } = require('./src/services/memory/memoryService');
saveMemory('test-user', null, { shouldRemember: true, category: 'profile', memory: 'User name is Tester', importance: 90 });
const rows = listMemories('test-user');
console.log('Saved rows:', rows);
deleteMemory(rows[0].id);
console.log('After delete:', listMemories('test-user'));
"
```

Expected:
- `Saved rows:` — one row with `memory: 'User name is Tester'` and `importance: 90`
- `After delete:` — empty array `[]`

- [ ] **Step 4: Commit**

```bash
git add src/services/memory/memoryService.ts
git commit -m "feat(memory): add CRUD memory service"
```

---

### Task 3: memoryRetriever.ts — keyword-scored retrieval

**Files:**
- Create: `src/services/memory/memoryRetriever.ts`

**Interfaces:**
- Consumes: `getRelevantMemories(userId, limit?)` from `./memoryService`; `MemoryRow` from `./types`
- Produces: `retrieveMemories(userId: string, prompt: string, limit?: number): string[]`
  - Returns plain-text memory strings, scored by keyword overlap + importance, max `limit` items

- [ ] **Step 1: Create `src/services/memory/memoryRetriever.ts`**

```typescript
import { getRelevantMemories } from './memoryService';
import type { MemoryRow } from './types';

function scoreMemory(row: MemoryRow, keywords: string[]): number {
  const lower = row.memory.toLowerCase();
  const keywordHits = keywords.filter((kw) => lower.includes(kw)).length;
  // keyword overlap weighted at 10 per hit, plus raw importance
  return keywordHits * 10 + row.importance;
}

export function retrieveMemories(userId: string, prompt: string, limit = 5): string[] {
  const candidates = getRelevantMemories(userId, 20);
  if (candidates.length === 0) return [];

  const keywords = prompt
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3);

  const scored = candidates
    .map((row) => ({ text: row.memory, score: scoreMemory(row, keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.text);

  if (scored.length > 0) {
    console.log(`[Memory] Retrieved ${scored.length} memories for user ${userId}`);
  }

  return scored;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test retrieval**

```bash
npx ts-node --project tsconfig.json -e "
const { saveMemory } = require('./src/services/memory/memoryService');
const { retrieveMemories } = require('./src/services/memory/memoryRetriever');
saveMemory('test-ret', null, { shouldRemember: true, category: 'hardware', memory: 'User owns RTX 4060', importance: 80 });
saveMemory('test-ret', null, { shouldRemember: true, category: 'profile', memory: 'User name is Aldi', importance: 90 });
console.log(retrieveMemories('test-ret', 'what is my graphics card?'));
"
```

Expected: array containing both memories, with `RTX 4060` ranked first (keyword `graphics` hits).

- [ ] **Step 4: Commit**

```bash
git add src/services/memory/memoryRetriever.ts
git commit -m "feat(memory): add keyword-scored memory retriever"
```

---

### Task 4: memoryDetector.ts — Gemini fact classification

**Files:**
- Create: `src/services/memory/memoryDetector.ts`

**Interfaces:**
- Consumes: `ai` from `../../ai/gemini`; `DetectionResult` from `./types`
- Produces: `detectMemory(userMessage: string): Promise<DetectionResult>`

Model used: `gemini-2.0-flash-lite` (cheapest/fastest — minimizes token cost for this classification step).

- [ ] **Step 1: Create `src/services/memory/memoryDetector.ts`**

```typescript
import ai from '../../ai/gemini';
import type { DetectionResult } from './types';

const DETECTION_PROMPT = `You are a memory classifier for an AI assistant.

Analyze the user message. Determine if it contains a fact worth storing for future conversations.

STORE persistent facts only. DO NOT store temporary states.

STORE examples:
- "My name is Aldi." → {"shouldRemember":true,"category":"profile","memory":"User's name is Aldi.","importance":100}
- "I use RTX 4060." → {"shouldRemember":true,"category":"hardware","memory":"User owns an RTX 4060 GPU.","importance":80}
- "I'm a software engineer." → {"shouldRemember":true,"category":"work","memory":"User works as a software engineer.","importance":80}
- "I like TypeScript." → {"shouldRemember":true,"category":"preference","memory":"User likes TypeScript.","importance":60}
- "I stream on YouTube." → {"shouldRemember":true,"category":"hobby","memory":"User streams on YouTube.","importance":60}

DO NOT STORE examples:
- "I'm eating." → {"shouldRemember":false}
- "I'm sleepy." → {"shouldRemember":false}
- "Today is hot." → {"shouldRemember":false}
- "I'm bored." → {"shouldRemember":false}

Categories: profile, preference, hardware, work, education, hobby, relationship, project, other

Importance scale: 100=critical (name/identity), 80=important (job/hardware), 60=useful (hobby/preference), 40=optional, 20=low

Rules:
- Write memory in third person ("User's name is...", "User owns...", "User works as...")
- Be concise — one fact per memory
- Respond with ONLY valid JSON. No markdown, no explanation, no code blocks.`;

export async function detectMemory(userMessage: string): Promise<DetectionResult> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-lite',
    contents: `${DETECTION_PROMPT}\n\nUser message: "${userMessage}"`,
  });

  const raw = (response.text ?? '').trim().replace(/^```(?:json)?\n?|\n?```$/g, '');

  try {
    return JSON.parse(raw) as DetectionResult;
  } catch {
    return { shouldRemember: false };
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test detector (requires GEMINI_API_KEY in `.env`)**

```bash
npx ts-node --project tsconfig.json -e "
const { detectMemory } = require('./src/services/memory/memoryDetector');
Promise.all([
  detectMemory('My name is Aldi and I work as a software engineer.'),
  detectMemory('I am so sleepy right now.'),
]).then(([fact, temp]) => {
  console.log('Fact message:', fact);
  console.log('Temp message:', temp);
});
"
```

Expected:
- `Fact message:` — `{ shouldRemember: true, category: 'profile' | 'work', memory: '...', importance: ... }`
- `Temp message:` — `{ shouldRemember: false }`

- [ ] **Step 4: Commit**

```bash
git add src/services/memory/memoryDetector.ts
git commit -m "feat(memory): add Gemini-based memory detector"
```

---

### Task 5: Integrate memory into chat.ts and messageCreate.ts

**Files:**
- Modify: `src/services/chat.ts` (add `guildId?`, retrieve memories, fire-and-forget detection)
- Modify: `src/events/messageCreate.ts` (pass `guildId` to `chat()`)

**Interfaces:**
- Consumes: `retrieveMemories(userId, prompt, limit?)` from `./memory/memoryRetriever`
- Consumes: `detectMemory(message)` from `./memory/memoryDetector`
- Consumes: `saveMemory(userId, guildId, detected)` from `./memory/memoryService`

Integration points in `chat()`:
1. Add `guildId?: string` to `ChatOptions` and destructure it
2. After building `dynamicSystemInstruction`, call `retrieveMemories` and append a memory block to the system instruction
3. After `replyText` is assigned, fire `detectMemory(promptText)` → save if `shouldRemember: true` (never awaited)

- [ ] **Step 1: Add imports to `src/services/chat.ts`**

Add three imports after the existing imports at the top of the file:

```typescript
import { retrieveMemories } from './memory/memoryRetriever';
import { detectMemory } from './memory/memoryDetector';
import { saveMemory } from './memory/memoryService';
```

- [ ] **Step 2: Add `guildId` to `ChatOptions` in `src/services/chat.ts`**

Update the interface:

```typescript
export interface ChatOptions {
  userId: string;
  guildId?: string;
  channelId: string;
  promptText: string;
  hasImage: boolean;
  imageUrl?: string;
}
```

- [ ] **Step 3: Destructure `guildId` in the function body**

The first line of `chat()` destructures options. Change:

```typescript
const { userId, channelId, promptText, hasImage, imageUrl } = options;
```

to:

```typescript
const { userId, guildId, channelId, promptText, hasImage, imageUrl } = options;
```

- [ ] **Step 4: Inject relevant memories into the system instruction**

In `chat()`, after this block:

```typescript
  if (userRow?.feedback_notes) {
    dynamicSystemInstruction += `\n[PERINTAH MUTLAK DARI USER YANG WAJIB KAMU PATUHI SAAT INI JUGA: ${userRow.feedback_notes}]`;
  }
```

Add:

```typescript
  const relevantMemories = retrieveMemories(userId, promptText);
  if (relevantMemories.length > 0) {
    const memoryBlock = relevantMemories.map((m) => `- ${m}`).join('\n');
    dynamicSystemInstruction += `\n\n[MEMORI RELEVAN TENTANG USER INI:\n${memoryBlock}\n]`;
  }
```

- [ ] **Step 5: Fire-and-forget memory detection after reply**

At the end of `chat()`, immediately before `return { replyText, engineIndicator }`, add:

```typescript
  if (replyText) {
    const resolvedGuildId = guildId ?? null;
    detectMemory(promptText)
      .then((result) => {
        if (result.shouldRemember) {
          saveMemory(userId, resolvedGuildId, result);
        }
      })
      .catch((err: unknown) => {
        console.error('[Memory] Detection failed (non-blocking):', err);
      });
  }
```

- [ ] **Step 6: Pass `guildId` in `src/events/messageCreate.ts`**

In the `chat()` call inside `registerMessageCreate`, add `guildId`:

```typescript
      const result = await chat({
        userId,
        guildId: message.guildId ?? undefined,
        channelId,
        promptText,
        hasImage,
        imageUrl: firstAttachment?.url,
      });
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Build**

```bash
npm run build
```

Expected: `dist/` populated with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/services/chat.ts src/events/messageCreate.ts
git commit -m "feat(memory): integrate long-term memory into chat pipeline"
```

---

## Self-Review — Spec Coverage

| Spec Requirement | Task |
|---|---|
| `user_memory` table with all 7 columns | Task 1 |
| `saveMemory()` | Task 2 |
| `getRelevantMemories()` | Task 2 |
| `deleteMemory()` | Task 2 |
| `updateMemory()` | Task 2 |
| `listMemories()` | Task 2 |
| Gemini-based detection, JSON-only response | Task 4 |
| `shouldRemember` / category / memory / importance JSON shape | Task 4 |
| All 9 categories | Task 3 (types), Task 4 (prompt) |
| Keyword-based retrieval, max 5 | Task 3 |
| Memory prepended as prompt block | Task 5 |
| Async, non-blocking save | Task 5 |
| Duplicate check → update `updated_at` + take higher importance | Task 2 |
| Logging `[Memory] Saved`, `[Memory] Updated`, `[Memory] Retrieved` | Task 2, 3 |
| No embeddings, no vector DB, SQLite only | All tasks |
| `src/services/memory/` file structure | Tasks 1–4 |

All spec requirements are covered.
