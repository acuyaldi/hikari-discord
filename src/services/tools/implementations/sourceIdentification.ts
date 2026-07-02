import axios from 'axios';
import {
  DEBUG_AI,
  SAUCENAO_API_KEY,
  SOURCE_ID_CONFIDENCE_THRESHOLD,
  SOURCE_ID_TIMEOUT_MS,
} from '../../../config/env';

const SAUCENAO_ENDPOINT = 'https://saucenao.com/search.php';

export const SOURCE_IDENTIFICATION_TRIGGER_KEYWORDS = [
  'ini gambar apa',
  'ini karakter siapa',
  'karakter siapa ini',
  'siapa karakter ini',
  'dari mana ini',
  'dari anime apa',
  'dari manga apa',
  'cari sumber gambar',
  'sumber gambar ini',
  'identify this image',
  'what is this from',
  'who is this character',
  'find the source',
  'source of this image',
];

export const NSFW_RISK_SAUCENAO_INDEXES = new Set([
  0, // h-mags
  1, // h-anime
  2, // hcg
  9, // danbooru
  11, // nijie
  12, // yande.re
  16, // FAKKU
  18, // H-MISC (nhentai)
  22, // H-Anime
  25, // gelbooru
  26, // konachan
  27, // sankaku
  29, // e621
  30, // idol complex
  38, // H-Misc (ehentai)
  40, // FurAffinity
  42, // Furry Network
  43, // Kemono
]);

export interface IdentificationMatch {
  title: string;
  source: string;
  similarity: number;
}

export interface IdentificationResult {
  available: boolean;
  match?: IdentificationMatch;
}

export interface IdentifySourceOptions {
  apiKey?: string;
  confidenceThreshold?: number;
  timeoutMs?: number;
}

interface SauceNaoResult {
  header?: {
    similarity?: string | number;
    index_id?: string | number;
    index?: string | number;
  };
  data?: Record<string, unknown>;
}

interface SauceNaoResponse {
  header?: {
    status?: number;
    message?: string;
  };
  results?: SauceNaoResult[];
}

function textField(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (Array.isArray(value)) {
      const firstString = value.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (firstString) return firstString.trim();
    }
  }
  return '';
}

function parseNumber(value: string | number | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanMatch(result: SauceNaoResult): IdentificationMatch | null {
  const similarity = parseNumber(result.header?.similarity);
  const data = result.data ?? {};
  if (similarity === null) return null;

  const title = textField(data, [
    'title',
    'eng_name',
    'jp_name',
    'material',
    'source',
    'created_at',
  ]);
  const source = textField(data, [
    'source',
    'part',
    'material',
    'eng_name',
    'jp_name',
    'title',
  ]);

  if (!title && !source) return null;

  return {
    title: title || source,
    source: source || title,
    similarity,
  };
}

export function detectIdentificationIntent(messageText: string): boolean {
  const normalized = messageText.toLowerCase().replace(/\s+/g, ' ').trim();
  return SOURCE_IDENTIFICATION_TRIGGER_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export async function identifySource(
  imageUrl: string,
  options: IdentifySourceOptions = {},
): Promise<IdentificationResult> {
  const confidenceThreshold = options.confidenceThreshold ?? SOURCE_ID_CONFIDENCE_THRESHOLD;
  const timeoutMs = options.timeoutMs ?? SOURCE_ID_TIMEOUT_MS;
  const apiKey = options.apiKey ?? SAUCENAO_API_KEY;

  try {
    const response = await axios.get<SauceNaoResponse>(SAUCENAO_ENDPOINT, {
      params: {
        output_type: 2,
        db: 999,
        numres: 5,
        hide: 3,
        url: imageUrl,
        ...(apiKey ? { api_key: apiKey } : {}),
      },
      timeout: timeoutMs,
    });

    if ((response.data.header?.status ?? 0) < 0) {
      if (DEBUG_AI) console.log('[SourceID] SauceNAO unavailable:', response.data.header?.message ?? 'unknown');
      return { available: false };
    }

    for (const result of response.data.results ?? []) {
      const indexId = parseNumber(result.header?.index_id ?? result.header?.index);
      const similarity = parseNumber(result.header?.similarity) ?? 0;
      if (indexId !== null && NSFW_RISK_SAUCENAO_INDEXES.has(indexId)) {
        if (DEBUG_AI) console.log(`[SourceID] discarded nsfw-risk index=${indexId} similarity=${similarity}`);
        continue;
      }
      if (similarity < confidenceThreshold) {
        if (DEBUG_AI) console.log(`[SourceID] discarded below threshold similarity=${similarity}`);
        continue;
      }

      const match = cleanMatch(result);
      if (match) {
        if (DEBUG_AI) console.log(`[SourceID] used match similarity=${match.similarity}`);
        return { available: true, match };
      }
    }

    if (DEBUG_AI) console.log('[SourceID] no confident safe match');
    return { available: false };
  } catch (error) {
    if (DEBUG_AI) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`[SourceID] lookup failed: ${reason}`);
    }
    return { available: false };
  }
}
