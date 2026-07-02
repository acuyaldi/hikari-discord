import { Type } from '@google/genai';

import ai from '../../../ai/gemini';
import {
  SUSUNKATA_WORD_MAX_LENGTH,
  SUSUNKATA_WORD_MIN_LENGTH,
} from '../../../config/env';
import { AIProviderName, TaskType } from '../../ai/types';
import {
  type WordEntry,
  validateWordBatch,
  validateWordEntry,
} from './wordValidator';

export type { WordEntry };

export const SUSUNKATA_MODEL = 'gemini-2.5-flash-lite';

export const SUSUNKATA_GENERATION_PROMPT = [
  'Generate a batch for Susun Kata in a SINGLE AI call.',
  `Generate exactly {count} DISTINCT Indonesian nouns/verbs (KBBI-valid), each ${SUSUNKATA_WORD_MIN_LENGTH}-${SUSUNKATA_WORD_MAX_LENGTH} letters long.`,
  "Provide one short, clear clue per word that doesn't contain or directly hint the word itself.",
  'Avoid offensive, sensitive, or NSFW words entirely.',
  'Return strictly as JSON: [{ "word": "...", "clue": "..." }, ...]',
].join('\n');

const SUSUNKATA_SYSTEM_INSTRUCTION = [
  'You are an Indonesian word puzzle content generator.',
  'Return raw JSON only. No markdown, no prose, no explanation.',
  'Every word must be a common Indonesian noun or verb suitable for a family game.',
].join('\n');

interface GenerateWordBatchDependencies {
  directGenerate?: (count: number, prompt: string) => Promise<string>;
  providerGenerate?: (count: number, prompt: string) => Promise<string>;
}

interface GetValidatedWordBatchDependencies {
  generateBatch?: (count: number) => Promise<WordEntry[]>;
}

function promptForCount(count: number): string {
  return SUSUNKATA_GENERATION_PROMPT.replace('{count}', String(count));
}

function sanitizeJsonResponse(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');

  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  return trimmed;
}

function parseWordBatch(rawJson: string): WordEntry[] {
  const parsed = JSON.parse(sanitizeJsonResponse(rawJson)) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Invalid susunkata response: root must be array');
  }

  return parsed.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { word?: unknown }).word !== 'string' ||
      typeof (item as { clue?: unknown }).clue !== 'string'
    ) {
      throw new Error('Invalid susunkata response: entry shape');
    }

    const entry: WordEntry = {
      word: (item as { word: string }).word.trim().toLowerCase(),
      clue: (item as { clue: string }).clue.trim(),
    };

    if (!validateWordEntry(entry).valid) {
      throw new Error('Invalid susunkata response: entry validation');
    }

    return entry;
  });
}

async function directGeminiGenerate(count: number, prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: SUSUNKATA_MODEL,
    contents: prompt,
    config: {
      systemInstruction: SUSUNKATA_SYSTEM_INSTRUCTION,
      temperature: 1,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            clue: { type: Type.STRING },
          },
          required: ['word', 'clue'],
          propertyOrdering: ['word', 'clue'],
        },
        minItems: count,
        maxItems: count,
      },
    },
  });

  const text = response.text;
  if (!text || text.trim().length === 0) {
    throw new Error('Susun Kata AI returned empty response');
  }

  return text;
}

async function providerRouterGenerate(_count: number, prompt: string): Promise<string> {
  const { providerManager } = await import('../../ai/providerManager');
  const response = await providerManager.generate({
    userId: 'susunkata-system',
    guildId: null,
    channelId: 'susunkata-system',
    promptText: prompt,
    identityPrefix: '',
    finalPrompt: prompt,
    dynamicSystemInstruction: SUSUNKATA_SYSTEM_INSTRUCTION,
    hasImage: false,
    taskType: TaskType.GENERAL,
    preferredProviders: [
      AIProviderName.OPENROUTER,
      AIProviderName.HUGGINGFACE,
      AIProviderName.GROQ,
    ],
  });

  return response.replyText;
}

export async function generateWordBatch(
  count: number,
  dependencies: GenerateWordBatchDependencies = {},
): Promise<WordEntry[]> {
  const directGenerate = dependencies.directGenerate ?? directGeminiGenerate;
  const providerGenerate = dependencies.providerGenerate ?? providerRouterGenerate;
  const prompt = promptForCount(count);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return parseWordBatch(await directGenerate(count, prompt));
    } catch (error) {
      lastError = error;
      console.error(
        `[SusunKata] generate word batch failed (attempt ${attempt}/2):`,
        error,
      );
    }
  }

  try {
    return parseWordBatch(await providerGenerate(count, prompt));
  } catch (error) {
    lastError = error;
    console.error('[SusunKata] provider-router fallback also failed:', error);
  }

  throw lastError ?? new Error('Susun Kata generation failed');
}

export async function getValidatedWordBatch(
  count: number,
  dependencies: GetValidatedWordBatchDependencies = {},
): Promise<WordEntry[]> {
  const generateBatch = dependencies.generateBatch ?? generateWordBatch;
  const accepted: WordEntry[] = [];
  const seenWords = new Set<string>();
  let remaining = Math.max(0, count);

  for (let attempt = 0; attempt <= 2 && remaining > 0; attempt += 1) {
    try {
      const generated = await generateBatch(remaining);
      const batch = validateWordBatch(generated);

      for (const entry of batch.valid) {
        const normalized = entry.word.trim().toLowerCase();
        if (seenWords.has(normalized)) continue;
        seenWords.add(normalized);
        accepted.push(entry);
      }
    } catch (error) {
      console.error('[SusunKata] validated batch generation failed:', error);
    }

    remaining = count - accepted.length;
  }

  return accepted.slice(0, count);
}
