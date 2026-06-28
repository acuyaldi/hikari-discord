import type { DetectionResult } from './types';

const DEBUG = process.env.DEBUG_MEMORY === 'true';

/** Logs the detector result when DEBUG_MEMORY=true. */
export function logDetection(result: DetectionResult): void {
  if (!DEBUG) return;

  if (!result.shouldRemember) {
    console.log('[Memory Detector]\nShould Remember: false');
    return;
  }

  console.log(
    `[Memory Detector]\n` +
      `Should Remember: true\n` +
      `Category: ${result.category}\n` +
      `Importance: ${result.importance}\n` +
      `Confidence: ${result.confidence}\n` +
      `Memory:\n${result.memory}`,
  );
}

/** Logs retrieved memories when DEBUG_MEMORY=true. */
export function logRetrieval(memories: string[]): void {
  if (!DEBUG || memories.length === 0) return;

  const list = memories.map((m) => `- ${m}`).join('\n');
  console.log(`[Memory Retriever]\nRetrieved Memories:\n${list}`);
}

/**
 * Logs a memory service operation when DEBUG_MEMORY=true.
 * @param action - Function name or operation label
 * @param detail - Optional extra context (e.g. "duplicate found")
 */
export function logService(action: string, detail?: string): void {
  if (!DEBUG) return;
  const line = detail ? `[Memory Service] ${action} — ${detail}` : `[Memory Service] ${action}`;
  console.log(line);
}
