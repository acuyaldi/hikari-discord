import dotenv from 'dotenv';
dotenv.config();

export const DISCORD_TOKEN       = process.env.DISCORD_TOKEN       ?? '';
export const GEMINI_API_KEY      = process.env.GEMINI_API_KEY      ?? '';
export const GROQ_API_KEY        = process.env.GROQ_API_KEY        ?? '';
export const SPESIFIK_CHANNEL_ID = process.env.SPESIFIK_CHANNEL_ID ?? '';
export const OPENROUTER_API_KEY  = process.env.OPENROUTER_API_KEY  ?? '';
export const OPENROUTER_MODELS: string[] = (
  process.env.OPENROUTER_MODELS ?? 'qwen/qwen3-32b:free,deepseek/deepseek-chat:free,google/gemma-3-27b-it:free'
)
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m.length > 0);
export const AI_PROVIDER_ORDER   = process.env.AI_PROVIDER_ORDER   ?? 'gemini,groq,openrouter';
