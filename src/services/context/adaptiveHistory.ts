import {
  ADAPTIVE_HISTORY_MIN_MESSAGES,
  ADAPTIVE_HISTORY_WINDOW_SIZE,
  DEBUG_SUMMARY,
} from '../../config/env';
import type { ChatMessage } from './contextBuilder';

export type AdaptiveHistoryReason =
  | 'no-summary-fallback'
  | 'adaptive-with-summary'
  | 'below-threshold-no-trim';

export interface ResolveHistoryWindowInput {
  hasSummary: boolean;
  totalAvailableMessages: ChatMessage[];
  fallbackWindowSize: number;
}

export interface ResolveHistoryWindowResult {
  messages: ChatMessage[];
  windowSizeUsed: number;
  reason: AdaptiveHistoryReason;
}

function safeWindowSize(size: number, total: number): number {
  if (!Number.isFinite(size) || size < 0) return total;
  return Math.min(Math.floor(size), total);
}

function takeMostRecent(messages: ChatMessage[], size: number): ChatMessage[] {
  if (size <= 0) return [];
  return messages.slice(Math.max(0, messages.length - size));
}

function fallbackWindow(messages: ChatMessage[], fallbackWindowSize: number): ResolveHistoryWindowResult {
  const windowSize = safeWindowSize(fallbackWindowSize, messages.length);
  return {
    messages: takeMostRecent(messages, windowSize),
    windowSizeUsed: windowSize,
    reason: 'no-summary-fallback',
  };
}

function logAdaptiveHistory(result: ResolveHistoryWindowResult, input: ResolveHistoryWindowInput): void {
  if (!DEBUG_SUMMARY) return;

  console.log(
    [
      '[Adaptive History]',
      `hasSummary: ${input.hasSummary}`,
      `totalAvailableMessages count: ${input.totalAvailableMessages.length}`,
      `windowSizeUsed: ${result.windowSizeUsed}`,
      `reason: ${result.reason}`,
    ].join('\n'),
  );
}

/** Resolves how much recent chat history should ride with the final prompt context. */
export function resolveHistoryWindow(input: ResolveHistoryWindowInput): ResolveHistoryWindowResult {
  try {
    const totalCount = input.totalAvailableMessages.length;
    if (totalCount === 0) {
      return { messages: [], windowSizeUsed: 0, reason: 'no-summary-fallback' };
    }

    if (!input.hasSummary) {
      return fallbackWindow(input.totalAvailableMessages, input.fallbackWindowSize);
    }

    if (totalCount <= ADAPTIVE_HISTORY_MIN_MESSAGES) {
      return {
        messages: input.totalAvailableMessages.slice(),
        windowSizeUsed: totalCount,
        reason: 'below-threshold-no-trim',
      };
    }

    const windowSize = safeWindowSize(ADAPTIVE_HISTORY_WINDOW_SIZE, totalCount);
    return {
      messages: takeMostRecent(input.totalAvailableMessages, windowSize),
      windowSizeUsed: windowSize,
      reason: 'adaptive-with-summary',
    };
  } catch (error) {
    if (DEBUG_SUMMARY) {
      console.error('[Adaptive History]\nfailed to resolve history window, falling back:', error);
    }

    try {
      return fallbackWindow(input.totalAvailableMessages, input.fallbackWindowSize);
    } catch {
      return {
        messages: [],
        windowSizeUsed: safeWindowSize(input.fallbackWindowSize, input.totalAvailableMessages.length),
        reason: 'no-summary-fallback',
      };
    }
  }
}

/** Returns only the messages selected for prompt context, with debug logging when enabled. */
export function trimHistoryForContext(input: ResolveHistoryWindowInput): ChatMessage[] {
  const result = resolveHistoryWindow(input);
  logAdaptiveHistory(result, input);
  return result.messages;
}
