import type { ChatInputCommandInteraction } from 'discord.js';
import type Database from 'better-sqlite3';

export type GroqMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface CommandContext {
  db: Database.Database;
}

export interface UserRow {
  nickname: string | null;
  feedback_notes: string | null;
  engine_pref: string | null;
}

export interface Command {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction, context: CommandContext) => Promise<void>;
}
