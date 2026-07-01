import ai from '../../ai/gemini';
import { DEBUG_MEMORY, MEMORY_DETECTOR_MODEL } from '../../config/env';
import type { MemoryCategory } from './types';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Returned by {@link detectMemory}.
 *
 * - `insert` — a new fact the model has never seen before
 * - `update` — a fact that revises an existing one ("I upgraded to RTX 5070")
 * - `ignore` — nothing worth storing; only `action` is present
 */
export type MemoryDecision =
  | {
      action: 'insert';
      category: MemoryCategory;
      memory: string;
      importance: number;
      confidence: number;
    }
  | {
      action: 'update';
      category: MemoryCategory;
      memory: string;
      newMemory?: string;
      oldMemoryHint?: string;
      targetMemoryId?: number;
      importance: number;
      confidence: number;
    }
  | { action: 'ignore' };

// ── Constants ──────────────────────────────────────────────────────────────────

/** Cheapest Gemini model sufficient for JSON classification. */
const MODEL = MEMORY_DETECTOR_MODEL;

const IGNORE: MemoryDecision = { action: 'ignore' };

const DEBUG = DEBUG_MEMORY;

const MIN_LENGTH = 15;

/** Short replies that can never contain a long-term fact. */
const NOISE_WORDS = new Set([
  'ok', 'oke', 'iya', 'ya', 'yep', 'yup', 'nope', 'nah',
  'lol', 'wkwk', 'haha', 'hehe', 'hihi',
  'thanks', 'thx', 'makasih', 'makasi',
  'nice', 'mantap', 'mantep', 'sip', 'siap',
  'hmm', 'hm', 'oh', 'ah', 'uh', 'eh',
  'oke deh', 'iya deh', 'gitu ya', 'gitu deh',
]);

/** Matches strings that are only emoji (Unicode emoji + variation selectors + ZWJ). */
const EMOJI_ONLY = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}️‍\s]+$/u;

/** Matches a bare URL with no surrounding text. */
const URL_ONLY = /^\s*(https?:\/\/\S+|www\.\S+)\s*$/i;

/** Matches bot/slash command prefixes. */
const COMMAND_PREFIX = /^[/!.?$]/;

const VALID_CATEGORIES = new Set<MemoryCategory>([
  'profile',
  'preference',
  'hardware',
  'work',
  'education',
  'project',
  'hobby',
  'relationship',
  'other',
]);

// ── Public helpers ─────────────────────────────────────────────────────────────

/**
 * Returns `true` when a message is worth sending to the detector.
 *
 * Acts as a cheap gate before the Gemini API call. Filters out messages that
 * can never contain a long-term memory: commands, emoji-only, bare URLs,
 * messages that are too short, and common noise words.
 *
 * @param message - Raw message text sent by the user
 */
export function shouldAnalyzeForMemory(message: string): boolean {
  const trimmed = message.trim();

  if (trimmed.length < MIN_LENGTH) return false;
  if (COMMAND_PREFIX.test(trimmed)) return false;
  if (EMOJI_ONLY.test(trimmed)) return false;
  if (URL_ONLY.test(trimmed)) return false;
  if (NOISE_WORDS.has(trimmed.toLowerCase())) return false;

  return true;
}

// ── Private helpers ────────────────────────────────────────────────────────────

function buildPrompt(message: string): string {
  return `You are a memory classifier for a personal AI assistant.

Decide if the user message contains a fact worth storing for future conversations.

## Remember (return insert or update)
- Personal identity: name, age, nationality
- Occupation, profession, job title
- Education background
- Long-term hardware: GPU, PC, peripherals
- Main ongoing projects (e.g. "I am building Hikari")
- Programming language preferences
- Streaming platforms, hobbies
- Preferred tools or software

## Ignore (return ignore)
- Temporary states: "I'm sleepy", "I'm bored", "I'm eating", "I'm going to lunch"
- Weather or transient environment: "It's raining", "my internet is slow today"
- Daily activities with no lasting meaning
- Vague moods: "I'm tired today"

## insert vs update
- Return "update" when the message implies a change to an existing fact:
  "I upgraded to ...", "I switched to ...", "I changed jobs", "now I use ..."
- Return "insert" for a first-time statement of a fact
- For "update", put the replacement fact in "memory" and include "oldMemoryHint"
  when the message mentions or strongly implies the old fact being replaced.

## Categories
profile      — name, age, nationality
work         — job title, profession, employer
education    — school, major, degree
hardware     — GPU, PC, peripherals, devices
project      — ongoing personal or professional projects
preference   — programming language, editor, OS, tools
hobby        — gaming, streaming, sports, creative work
relationship — family, friends, pets
other        — anything that doesn't fit above

## Importance guidelines
100 — Critical identity (name, main occupation)
90  — Long-term hardware, main project, profession
80  — Strong preferences (language, streaming platform, hobbies)
60  — Useful facts (editor, OS)
40  — Minor preferences

## Confidence
80–100 — Explicit statement ("My name is X", "I use Y")
40–79  — Indirect implication
0–39   — Guess or ambiguous

## Response format
Return ONLY valid JSON. No markdown, no explanation.

If worth remembering:
{"action":"insert","category":"hardware","memory":"User owns an RTX 4060.","importance":90,"confidence":100}

If updating an existing fact:
{"action":"update","category":"hardware","memory":"User uses an RTX 5070.","oldMemoryHint":"previous GPU","importance":90,"confidence":100}

If nothing worth remembering:
{"action":"ignore"}

User message:
${message}`;
}

function parseDecision(raw: string): unknown {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

function validateDecision(parsed: unknown): MemoryDecision {
  if (typeof parsed !== 'object' || parsed === null) return IGNORE;

  const obj = parsed as Record<string, unknown>;
  const action = obj['action'];

  if (action === 'ignore') return IGNORE;
  if (action !== 'insert' && action !== 'update') return IGNORE;

  const category = obj['category'];
  const memory = obj['memory'] ?? obj['newMemory'];
  const newMemory = obj['newMemory'];
  const oldMemoryHint = obj['oldMemoryHint'];
  const targetMemoryId = obj['targetMemoryId'];
  const importance = obj['importance'];
  const confidence = obj['confidence'];

  if (typeof category !== 'string' || !VALID_CATEGORIES.has(category as MemoryCategory)) return IGNORE;
  if (typeof memory !== 'string' || memory.trim().length === 0) return IGNORE;
  if (typeof importance !== 'number' || typeof confidence !== 'number') return IGNORE;
  if (newMemory !== undefined && typeof newMemory !== 'string') return IGNORE;
  if (oldMemoryHint !== undefined && typeof oldMemoryHint !== 'string') return IGNORE;
  if (targetMemoryId !== undefined && !Number.isInteger(targetMemoryId)) return IGNORE;

  const baseDecision = {
    action,
    category: category as MemoryCategory,
    memory: memory.trim(),
    importance: Math.max(0, Math.min(100, Math.round(importance))),
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
  };

  if (action === 'update') {
    return {
      ...baseDecision,
      action,
      ...(newMemory !== undefined ? { newMemory: newMemory.trim() } : {}),
      ...(oldMemoryHint !== undefined ? { oldMemoryHint: oldMemoryHint.trim() } : {}),
      ...(targetMemoryId !== undefined ? { targetMemoryId: targetMemoryId as number } : {}),
    };
  }

  return { ...baseDecision, action };
}

function logDecision(message: string, decision: MemoryDecision): void {
  if (!DEBUG) return;

  if (decision.action === 'ignore') {
    console.log(`[Memory Detector]\nUser: ${message}\nReason: ignore`);
    return;
  }

  console.log(
    `[Memory Detector]\n` +
      `User: ${message}\n` +
      `Decision: ${decision.action}\n` +
      `Category: ${decision.category}\n` +
      `Memory: ${decision.memory}\n` +
      (decision.action === 'update' && decision.oldMemoryHint
        ? `Old hint: ${decision.oldMemoryHint}\n`
        : '') +
      (decision.action === 'update' && decision.targetMemoryId !== undefined
        ? `Target ID: ${decision.targetMemoryId}\n`
        : '') +
      `Importance: ${decision.importance}\n` +
      `Confidence: ${decision.confidence}`,
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classifies a user message and decides whether it contains a long-term memory.
 *
 * Uses Gemini with JSON-mode output to detect facts worth storing.
 * The function **never throws** — Gemini failures, invalid JSON, or timeouts
 * all produce `{ action: "ignore" }`.
 *
 * @param message - Raw message text sent by the user
 * @returns A {@link MemoryDecision} describing the classification result
 */
export async function detectMemory(message: string): Promise<MemoryDecision> {
  if (!shouldAnalyzeForMemory(message)) return IGNORE;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: buildPrompt(message),
      config: {
        responseMimeType: 'application/json',
      },
    });

    const raw = response.text ?? '';
    const parsed = parseDecision(raw);
    const decision = validateDecision(parsed);

    logDecision(message, decision);
    return decision;
  } catch {
    if (DEBUG) console.log(`[Memory Detector]\nUser: ${message}\nReason: ignore`);
    return IGNORE;
  }
}
