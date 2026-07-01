import type { SummaryRow } from './types';

/** Returns the current epoch timestamp in milliseconds. */
export function currentTimestamp(): number {
  return Date.now();
}

/** Converts a raw SQLite row into a typed summary row. */
export function mapRow(row: Record<string, unknown>): SummaryRow {
  return {
    id: row['id'] as number,
    user_id: row['user_id'] as string,
    guild_id: (row['guild_id'] as string | null) ?? null,
    summary: row['summary'] as string,
    message_count: row['message_count'] as number,
    created_at: row['created_at'] as number,
    updated_at: row['updated_at'] as number,
    last_message_at: row['last_message_at'] as number,
  };
}
