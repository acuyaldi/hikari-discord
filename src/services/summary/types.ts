export interface SummaryRow {
  id: number;
  user_id: string;
  guild_id: string | null;
  summary: string;
  message_count: number;
  created_at: number;
  updated_at: number;
  last_message_at: number;
}

export interface SummaryInput {
  userId: string;
  guildId: string | null;
  summary: string;
  messageCount?: number;
  lastMessageAt?: number;
}

export type SummaryResult<T> = { success: true; data: T } | { success: false; error: string };
