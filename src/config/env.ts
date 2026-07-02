import dotenv from 'dotenv';
dotenv.config();

export const DISCORD_TOKEN       = process.env.DISCORD_TOKEN       ?? '';
export const GEMINI_API_KEY      = process.env.GEMINI_API_KEY      ?? '';
export const GROQ_API_KEY        = process.env.GROQ_API_KEY        ?? '';
export const SPESIFIK_CHANNEL_ID = process.env.SPESIFIK_CHANNEL_ID ?? '';
export const OPENROUTER_API_KEY  = process.env.OPENROUTER_API_KEY  ?? '';
export const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY ?? '';
export const OPENROUTER_MODELS: string[] = (
  process.env.OPENROUTER_MODELS ?? 'meta-llama/llama-3.3-8b-instruct:free,google/gemma-2-9b-it:free,mistralai/mistral-7b-instruct:free,qwen/qwen2.5-7b-instruct:free'
)
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m.length > 0);
export const HUGGINGFACE_MODELS: string[] = (
  process.env.HUGGINGFACE_MODELS ??
  'meta-llama/Llama-3.1-8B-Instruct,Qwen/Qwen2.5-7B-Instruct,google/gemma-2-9b-it'
)
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m.length > 0);
export const OPENROUTER_ALLOW_PAID_FALLBACK = process.env.OPENROUTER_ALLOW_PAID_FALLBACK === 'true';
export const AI_PROVIDER_ORDER   = process.env.AI_PROVIDER_ORDER   ?? 'gemini,groq,openrouter,huggingface';
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = Number.parseInt(
  process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? '3',
  10,
);
export const CIRCUIT_BREAKER_COOLDOWN_MS = Number.parseInt(
  process.env.CIRCUIT_BREAKER_COOLDOWN_MS ?? '300000',
  10,
);
export const COOLDOWN_SECONDS = Number.parseInt(
  process.env.COOLDOWN_SECONDS ?? '4',
  10,
);
export const SUMMARY_TRIGGER_MESSAGE_COUNT = Number.parseInt(
  process.env.SUMMARY_TRIGGER_MESSAGE_COUNT ?? '50',
  10,
);
export const SUMMARY_MAX_INPUT_MESSAGES = Number.parseInt(
  process.env.SUMMARY_MAX_INPUT_MESSAGES ?? '40',
  10,
);
export const SUMMARY_MAX_CONTEXT_LENGTH = Number.parseInt(
  process.env.SUMMARY_MAX_CONTEXT_LENGTH ?? '1500',
  10,
);
export const ADAPTIVE_HISTORY_MIN_MESSAGES = Number.parseInt(
  process.env.ADAPTIVE_HISTORY_MIN_MESSAGES ?? '15',
  10,
);
export const ADAPTIVE_HISTORY_WINDOW_SIZE = Number.parseInt(
  process.env.ADAPTIVE_HISTORY_WINDOW_SIZE ?? '20',
  10,
);
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? 'gemini-2.5-flash-lite';
export const MEMORY_DETECTOR_MODEL = process.env.MEMORY_DETECTOR_MODEL ?? 'gemini-2.5-flash-lite';
export const DEBUG_SUMMARY = process.env.DEBUG_SUMMARY === 'true';
export const DEBUG_AI = process.env.DEBUG_AI === 'true';
export const DEBUG_MEMORY = process.env.DEBUG_MEMORY === 'true';
export const TOOL_CALLING_ENABLED = process.env.TOOL_CALLING_ENABLED !== 'false';
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? '';
export const WEB_SEARCH_MAX_RESULTS = Number.parseInt(
  process.env.WEB_SEARCH_MAX_RESULTS ?? '5',
  10,
);
export const TOOL_MAX_ITERATIONS = Number.parseInt(
  process.env.TOOL_MAX_ITERATIONS ?? '3',
  10,
);
export const TOOL_EXECUTION_TIMEOUT_MS = Number.parseInt(
  process.env.TOOL_EXECUTION_TIMEOUT_MS ?? '10000',
  10,
);
export const IMAGE_MAX_SIZE_MB = Number.parseInt(
  process.env.IMAGE_MAX_SIZE_MB ?? '10',
  10,
);
export const IMAGE_ANALYSIS_ENABLED = process.env.IMAGE_ANALYSIS_ENABLED !== 'false';
export const MENTION_CONTEXT_LOOKBACK = Number.parseInt(
  process.env.MENTION_CONTEXT_LOOKBACK ?? '5',
  10,
);
export const DEBUG_CONTEXT = process.env.DEBUG_CONTEXT === 'true';

export const DEFAULT_TTS_TRIGGER_KEYWORDS = [
  'jawab pakai suara',
  'voice note',
  'kirim suara',
  'reply with voice',
  'bisa voice note gak',
];

export const TTS_TRIGGER_KEYWORDS: string[] = (
  process.env.TTS_TRIGGER_KEYWORDS ?? DEFAULT_TTS_TRIGGER_KEYWORDS.join(',')
)
  .split(',')
  .map((keyword) => keyword.trim())
  .filter((keyword) => keyword.length > 0);
