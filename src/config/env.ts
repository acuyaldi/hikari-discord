import dotenv from 'dotenv';
dotenv.config();

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
export const SPESIFIK_CHANNEL_ID = process.env.SPESIFIK_CHANNEL_ID ?? '';
