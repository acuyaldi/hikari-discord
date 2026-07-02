import {
  SUSUNKATA_WORD_MAX_LENGTH,
  SUSUNKATA_WORD_MIN_LENGTH,
} from '../../../config/env';

export interface WordEntry {
  word: string;
  clue: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface BatchValidationResult {
  valid: WordEntry[];
  rejected: WordEntry[];
}

// Basic safety net only. This is intentionally small and should not be treated
// as a comprehensive moderation or KBBI validation system.
const BASIC_OFFENSIVE_WORD_BLOCKLIST = [
  'anjing',
  'babi',
  'bangsat',
  'kontol',
  'memek',
];

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function validateWordEntry(entry: WordEntry): ValidationResult {
  const word = normalizeWord(entry.word);
  const clue = entry.clue.trim();

  if (word.length === 0) {
    return { valid: false, reason: 'word_empty' };
  }

  if (
    word.length < SUSUNKATA_WORD_MIN_LENGTH ||
    word.length > SUSUNKATA_WORD_MAX_LENGTH
  ) {
    return { valid: false, reason: 'word_length' };
  }

  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ]+$/.test(word)) {
    return { valid: false, reason: 'word_alphabetic' };
  }

  if (BASIC_OFFENSIVE_WORD_BLOCKLIST.includes(word)) {
    return { valid: false, reason: 'word_blocklisted' };
  }

  if (clue.length === 0) {
    return { valid: false, reason: 'clue_empty' };
  }

  if (
    BASIC_OFFENSIVE_WORD_BLOCKLIST.some((blockedWord) =>
      clue.toLowerCase().includes(blockedWord),
    )
  ) {
    return { valid: false, reason: 'clue_blocklisted' };
  }

  if (clue.toLowerCase().includes(word)) {
    return { valid: false, reason: 'clue_contains_word' };
  }

  return { valid: true };
}

export function validateWordBatch(entries: WordEntry[]): BatchValidationResult {
  const valid: WordEntry[] = [];
  const rejected: WordEntry[] = [];
  const seenWords = new Set<string>();

  for (const entry of entries) {
    const normalized = normalizeWord(entry.word);
    const result = validateWordEntry(entry);

    if (!result.valid || seenWords.has(normalized)) {
      rejected.push(entry);
      continue;
    }

    seenWords.add(normalized);
    valid.push({
      word: normalized,
      clue: entry.clue.trim(),
    });
  }

  return { valid, rejected };
}
