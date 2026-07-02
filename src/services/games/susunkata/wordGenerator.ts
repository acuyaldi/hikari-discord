import { Type } from '@google/genai';

import ai from '../../../ai/gemini';
import { AIProviderName, TaskType } from '../../ai/types';
import { COMMON_WORDS } from './commonWords';
import {
  type WordEntry,
  validateWordBatch,
  validateWordEntry,
} from './wordValidator';

export type { WordEntry };

export const SUSUNKATA_MODEL = 'gemini-2.5-flash-lite';

export const SUSUNKATA_GENERATION_PROMPT = [
  'Untuk setiap kata berikut, buatkan satu clue singkat yang tidak mengandung kata itu sendiri: {words}.',
  'Jawab sebagai JSON: [{ "word": "...", "clue": "..." }, ...] dengan urutan kata yang sama persis seperti diberikan.',
  'Return strictly as JSON only. No markdown, no explanation.',
].join('\n');

const SUSUNKATA_SYSTEM_INSTRUCTION = [
  'You are an Indonesian word puzzle clue generator.',
  'The words are fixed inputs. Do not replace, add, remove, translate, or invent words.',
  'Return raw JSON only. No markdown, no prose, no explanation.',
].join('\n');

interface GenerateWordBatchDependencies {
  directGenerate?: (count: number, prompt: string) => Promise<string>;
  providerGenerate?: (count: number, prompt: string) => Promise<string>;
  selectWords?: (count: number) => string[];
  substituteWords?: (count: number, excludedWords: Set<string>) => string[];
  clueRetryLimit?: number;
}

interface GetValidatedWordBatchDependencies extends GenerateWordBatchDependencies {
  generateBatch?: (count: number) => Promise<WordEntry[]>;
}

function promptForWords(words: string[]): string {
  return SUSUNKATA_GENERATION_PROMPT.replace('{words}', words.join(', '));
}

export function selectRandomWords(count: number): string[] {
  const shuffled = [...COMMON_WORDS];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled.slice(0, Math.max(0, Math.min(count, shuffled.length)));
}

function selectSubstituteWords(count: number, excludedWords: Set<string>): string[] {
  return selectRandomWords(COMMON_WORDS.length)
    .filter((word) => !excludedWords.has(word))
    .slice(0, count);
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

function parseClueBatch(rawJson: string): WordEntry[] {
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

    return {
      word: (item as { word: string }).word.trim().toLowerCase(),
      clue: (item as { clue: string }).clue.trim(),
    };
  });
}

function entryForExpectedWord(entries: WordEntry[], word: string, index = 0): WordEntry | null {
  const entry = entries[index];
  if (!entry || entry.word !== word) return null;

  const candidate = { word, clue: entry.clue };
  return validateWordEntry(candidate).valid ? candidate : null;
}

async function directGeminiGenerate(count: number, prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: SUSUNKATA_MODEL,
    contents: prompt,
    config: {
      systemInstruction: SUSUNKATA_SYSTEM_INSTRUCTION,
      temperature: 0.9,
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

async function requestCluesForWords(
  words: string[],
  dependencies: Required<Pick<GenerateWordBatchDependencies, 'directGenerate' | 'providerGenerate'>>,
): Promise<WordEntry[]> {
  const prompt = promptForWords(words);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return parseClueBatch(await dependencies.directGenerate(words.length, prompt));
    } catch (error) {
      lastError = error;
      console.error(
        `[SusunKata] generate clue batch failed (attempt ${attempt}/2):`,
        error,
      );
    }
  }

  try {
    return parseClueBatch(await dependencies.providerGenerate(words.length, prompt));
  } catch (error) {
    lastError = error;
    console.error('[SusunKata] provider-router clue fallback also failed:', error);
  }

  throw lastError ?? new Error('Susun Kata clue generation failed');
}

async function repairClueForWord(
  word: string,
  usedWords: Set<string>,
  dependencies: Required<
    Pick<GenerateWordBatchDependencies, 'directGenerate' | 'providerGenerate' | 'substituteWords' | 'clueRetryLimit'>
  >,
): Promise<WordEntry> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= dependencies.clueRetryLimit; attempt += 1) {
    try {
      const entries = await requestCluesForWords([word], dependencies);
      const repaired = entryForExpectedWord(entries, word);
      if (repaired) return repaired;
    } catch (error) {
      lastError = error;
    }
  }

  const substitute = dependencies.substituteWords(1, usedWords)[0];
  if (substitute) {
    usedWords.add(substitute);
    for (let attempt = 1; attempt <= Math.max(1, dependencies.clueRetryLimit); attempt += 1) {
      try {
        const entries = await requestCluesForWords([substitute], dependencies);
        const repaired = entryForExpectedWord(entries, substitute);
        if (repaired) return repaired;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError ?? new Error('Invalid susunkata response: entry validation');
}

export async function generateWordBatch(
  count: number,
  dependencies: GenerateWordBatchDependencies = {},
): Promise<WordEntry[]> {
  const directGenerate = dependencies.directGenerate ?? directGeminiGenerate;
  const providerGenerate = dependencies.providerGenerate ?? providerRouterGenerate;
  const selectedWords = (dependencies.selectWords ?? selectRandomWords)(count);
  const clueRetryLimit = dependencies.clueRetryLimit ?? 2;
  const substituteWords = dependencies.substituteWords ?? selectSubstituteWords;
  const usedWords = new Set(selectedWords);

  if (selectedWords.length === 0) return [];

  const generatorDependencies = { directGenerate, providerGenerate };
  const entries = await requestCluesForWords(selectedWords, generatorDependencies);
  const validEntries: WordEntry[] = [];

  for (let index = 0; index < selectedWords.length; index += 1) {
    const word = selectedWords[index]!;
    const validEntry = entryForExpectedWord(entries, word, index);

    if (validEntry) {
      validEntries.push(validEntry);
      continue;
    }

    validEntries.push(
      await repairClueForWord(word, usedWords, {
        ...generatorDependencies,
        clueRetryLimit,
        substituteWords,
      }),
    );
  }

  return validEntries;
}

export async function getValidatedWordBatch(
  count: number,
  dependencies: GetValidatedWordBatchDependencies = {},
): Promise<WordEntry[]> {
  const generateBatch =
    dependencies.generateBatch ??
    ((requestedCount: number) => generateWordBatch(requestedCount, dependencies));

  try {
    const generated = await generateBatch(count);
    return validateWordBatch(generated).valid.slice(0, count);
  } catch (error) {
    console.error('[SusunKata] validated batch generation failed:', error);
    return [];
  }
}
