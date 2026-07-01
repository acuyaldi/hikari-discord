import { DEBUG_SUMMARY } from '../../config/env';

/** Logs summary service activity when DEBUG_SUMMARY=true. */
export function logSummary(operation: string, message: string): void {
  if (!DEBUG_SUMMARY) return;
  console.log(`[Summary Service] ${operation}: ${message}`);
}
