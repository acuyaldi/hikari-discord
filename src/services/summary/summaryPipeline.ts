import {
  SUMMARY_MAX_INPUT_MESSAGES,
  SUMMARY_TRIGGER_MESSAGE_COUNT,
} from '../../config/env';
import { logSummary } from './summaryDebug';
import { generateConversationSummary } from './summaryGenerator';
import {
  createSummary,
  getSummary,
  incrementMessageCount,
  resetMessageCount,
  updateSummary,
} from './summaryService';
import type { SummaryInput, SummaryResult, SummaryRow } from './types';

export interface SummaryPipelineInput {
  userId: string;
  guildId: string | null;
  messageText: string;
  recentMessages?: string[];
}

interface SummaryUpdateFields {
  summary?: string;
  messageCount?: number;
  lastMessageAt?: number;
}

export interface SummaryPipelineDependencies {
  triggerMessageCount?: number;
  maxInputMessages?: number;
  getSummary?: (
    userId: string,
    guildId: string | null,
  ) => SummaryResult<SummaryRow | null> | Promise<SummaryResult<SummaryRow | null>>;
  createSummary?: (input: SummaryInput) => SummaryResult<SummaryRow> | Promise<SummaryResult<SummaryRow>>;
  incrementMessageCount?: (
    id: number,
    amount?: number,
    lastMessageAt?: number,
  ) => SummaryResult<SummaryRow | null> | Promise<SummaryResult<SummaryRow | null>>;
  updateSummary?: (
    id: number,
    fields: SummaryUpdateFields,
  ) => SummaryResult<SummaryRow | null> | Promise<SummaryResult<SummaryRow | null>>;
  resetMessageCount?: (
    id: number,
  ) => SummaryResult<SummaryRow | null> | Promise<SummaryResult<SummaryRow | null>>;
  generateSummary?: (input: {
    existingSummary: string | null;
    recentMessages: string[];
  }) => Promise<SummaryResult<string>>;
}

function recentMessagesFor(input: SummaryPipelineInput, maxInputMessages: number): string[] {
  const source = input.recentMessages && input.recentMessages.length > 0
    ? input.recentMessages
    : [input.messageText];
  return source.slice(-maxInputMessages).filter((message) => message.trim().length > 0);
}

function debugState(messageCount: number, threshold: number, triggered: boolean): void {
  logSummary(
    'Summary Pipeline',
    [
      `[Summary Pipeline]`,
      `message count: ${messageCount}`,
      `threshold: ${threshold}`,
      `triggered: ${triggered}`,
    ].join('\n'),
  );
}

async function loadOrCreateSummary(
  input: SummaryPipelineInput,
  deps: Required<Pick<SummaryPipelineDependencies, 'getSummary' | 'createSummary'>>,
): Promise<SummaryRow | null> {
  const existing = await deps.getSummary(input.userId, input.guildId);
  if (!existing.success) return null;
  if (existing.data) return existing.data;

  const created = await deps.createSummary({
    userId: input.userId,
    guildId: input.guildId,
    summary: '',
    messageCount: 1,
    lastMessageAt: Date.now(),
  });
  return created.success ? created.data : null;
}

/** Runs the summary pipeline and swallows all errors. */
export async function runSummaryPipeline(
  input: SummaryPipelineInput,
  dependencies: SummaryPipelineDependencies = {},
): Promise<void> {
  try {
    const threshold = dependencies.triggerMessageCount ?? SUMMARY_TRIGGER_MESSAGE_COUNT;
    const maxInputMessages = dependencies.maxInputMessages ?? SUMMARY_MAX_INPUT_MESSAGES;
    const deps = {
      getSummary: dependencies.getSummary ?? getSummary,
      createSummary: dependencies.createSummary ?? createSummary,
      incrementMessageCount: dependencies.incrementMessageCount ?? incrementMessageCount,
      updateSummary: dependencies.updateSummary ?? updateSummary,
      resetMessageCount: dependencies.resetMessageCount ?? resetMessageCount,
      generateSummary: dependencies.generateSummary ?? generateConversationSummary,
    };

    const loaded = await loadOrCreateSummary(input, deps);
    if (loaded === null) return;

    let summaryRow: SummaryRow | null = loaded;
    if (!(loaded.message_count === 1 && loaded.summary.length === 0)) {
      const counted = await deps.incrementMessageCount(loaded.id, 1, Date.now());
      if (!counted.success || counted.data === null) return;
      summaryRow = counted.data;
    }

    if (summaryRow === null) return;
    const triggered = summaryRow.message_count >= threshold;
    debugState(summaryRow.message_count, threshold, triggered);
    if (!triggered) return;

    const generated = await deps.generateSummary({
      existingSummary: summaryRow.summary || null,
      recentMessages: recentMessagesFor(input, maxInputMessages),
    });
    if (!generated.success) return;

    const updated = await deps.updateSummary(summaryRow.id, {
      summary: generated.data,
      lastMessageAt: Date.now(),
    });
    if (!updated.success || updated.data === null) return;

    await deps.resetMessageCount(summaryRow.id);
    logSummary(
      'Summary Pipeline',
      [`generated summary length: ${generated.data.length}`, 'updated summary'].join('\n'),
    );
  } catch (error) {
    logSummary('Summary Pipeline error', error instanceof Error ? error.message : String(error));
  }
}

/** Starts the summary pipeline in the background and never throws. */
export function maybeRunSummaryPipeline(
  input: SummaryPipelineInput,
  dependencies: SummaryPipelineDependencies = {},
): void {
  void runSummaryPipeline(input, dependencies);
}
