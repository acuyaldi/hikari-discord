import { detectMemory } from './memoryDetector';
import {
  existsMemory,
  getMemoryById,
  listMemories,
  saveMemory,
  updateMemory,
} from './memoryService';
import type { MemoryDecision } from './memoryDetector';
import type { MemoryRow } from './types';

const DEBUG = process.env.DEBUG_MEMORY === 'true';
const MIN_UPDATE_CONFIDENCE = 70;
const MIN_UPDATE_MATCH_SCORE = 55;

const TOKEN_STOPWORDS = new Set([
  'aku', 'saya', 'gue', 'gw', 'user', 'pengguna',
  'pakai', 'memakai', 'menggunakan', 'punya', 'memiliki',
  'use', 'uses', 'using', 'own', 'owns', 'have', 'has',
  'sekarang', 'now', 'currently', 'baru', 'lama',
  'adalah', 'is', 'am', 'are', 'the', 'a', 'an', 'my',
]);

const UPDATE_SLOT_PATTERNS: Array<[string, RegExp]> = [
  ['gpu', /\b(gpu|vga|rtx|gtx|radeon|geforce|nvidia)\b/i],
  ['laptop', /\b(laptop|thinkpad|macbook|notebook)\b/i],
  ['desktop-pc', /\b(pc|desktop|komputer)\b/i],
  ['location', /\b(tinggal|domisili|kota|city|live|lives|living)\b/i],
  ['nickname', /\b(panggil|dipanggil|call me|nickname|nick|nama panggilan)\b/i],
  ['name', /\b(nama|name)\b/i],
];

function pipelineLog(step: string): void {
  if (!DEBUG) return;
  console.log(`[Memory Pipeline] ${step}`);
}

function updateMemoryText(decision: Extract<MemoryDecision, { action: 'update' }>): string {
  return decision.newMemory ?? decision.memory;
}

function extractMatchTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((token) => token.length > 2 && !TOKEN_STOPWORDS.has(token)) ?? [],
    ),
  );
}

function inferUpdateSlots(text: string): string[] {
  return UPDATE_SLOT_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([slot]) => slot);
}

function countIntersection(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function scoreUpdateCandidate(
  candidate: MemoryRow,
  decision: Extract<MemoryDecision, { action: 'update' }>,
): number {
  const replacement = updateMemoryText(decision);
  const targetText = decision.oldMemoryHint ?? replacement;
  const targetTokens = extractMatchTokens(targetText);
  const candidateTokens = extractMatchTokens(candidate.memory);
  const overlap = countIntersection(targetTokens, candidateTokens);
  const smallerTokenSet = Math.min(targetTokens.length, candidateTokens.length);
  const tokenScore = smallerTokenSet > 0 ? (overlap / smallerTokenSet) * 100 : 0;

  const replacementSlots = inferUpdateSlots(replacement);
  const targetSlots = inferUpdateSlots(targetText);
  const candidateSlots = inferUpdateSlots(candidate.memory);
  const slotScore =
    countIntersection([...replacementSlots, ...targetSlots], candidateSlots) > 0 ? 70 : 0;

  return Math.max(tokenScore, slotScore);
}

function findUpdateTarget(
  userId: string,
  guildId: string | null,
  decision: Extract<MemoryDecision, { action: 'update' }>,
): MemoryRow | null {
  if (decision.confidence < MIN_UPDATE_CONFIDENCE) return null;

  if (decision.targetMemoryId !== undefined) {
    const targetResult = getMemoryById(decision.targetMemoryId);
    if (!targetResult.success || targetResult.data === null) return null;

    const target = targetResult.data;
    if (
      target.user_id === userId &&
      target.guild_id === guildId &&
      target.category === decision.category
    ) {
      return target;
    }
    return null;
  }

  const memoriesResult = listMemories(userId, decision.category);
  if (!memoriesResult.success) {
    pipelineLog(`Failed - listMemories: ${memoriesResult.error}`);
    return null;
  }

  const scored = memoriesResult.data
    .filter((candidate) => candidate.guild_id === guildId)
    .map((candidate) => ({
      candidate,
      score: scoreUpdateCandidate(candidate, decision),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best === undefined || best.score < MIN_UPDATE_MATCH_SCORE) return null;

  pipelineLog(`Update target: id=${best.candidate.id}, score=${best.score.toFixed(1)}`);
  return best.candidate;
}

/**
 * Detects whether a user message contains a long-term memory and persists it.
 *
 * Designed to be called with `void runMemoryPipeline(...)` — it must never
 * reject. All exceptions are caught and logged internally.
 */
export async function runMemoryPipeline(
  userId: string,
  guildId: string | null,
  message: string,
): Promise<void> {
  try {
    pipelineLog('Reply sent');
    pipelineLog('Detector started');

    const decision = await detectMemory(message);

    if (decision.action === 'ignore') {
      pipelineLog('Decision: ignore → Ignored');
      return;
    }

    pipelineLog(`Decision: ${decision.action}`);

    if (decision.action === 'update') {
      const target = findUpdateTarget(userId, guildId, decision);

      if (target !== null) {
        const updateResult = updateMemory(target.id, {
          memory: updateMemoryText(decision),
          category: decision.category,
          importance: decision.importance,
          confidence: decision.confidence,
        });

        pipelineLog(updateResult.success ? 'Updated' : `Failed - updateMemory: ${updateResult.error}`);
        return;
      }

      pipelineLog('Update target not found - falling back to save');
    }

    const existsResult = existsMemory(userId, decision.category, decision.memory);

    if (!existsResult.success) {
      pipelineLog(`Failed — existsMemory: ${existsResult.error}`);
      return;
    }

    if (existsResult.data) {
      pipelineLog('Duplicate: true → Already Exists');
      return;
    }

    pipelineLog('Duplicate: false');

    const saveResult = saveMemory({
      userId,
      guildId,
      category: decision.category,
      memory: decision.memory,
      importance: decision.importance,
      confidence: decision.confidence,
    });

    pipelineLog(saveResult.success ? 'Saved' : `Failed — ${saveResult.error}`);
  } catch (err) {
    pipelineLog(`Failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}
