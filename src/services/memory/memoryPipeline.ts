import { detectMemory } from './memoryDetector';
import { existsMemory, saveMemory } from './memoryService';

const DEBUG = process.env.DEBUG_MEMORY === 'true';

function pipelineLog(step: string): void {
  if (!DEBUG) return;
  console.log(`[Memory Pipeline] ${step}`);
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
