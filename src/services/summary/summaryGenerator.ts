import ai from '../../ai/gemini';
import { SUMMARY_MODEL } from '../../config/env';
import type { SummaryResult } from './types';

export interface SummaryPromptInput {
  existingSummary: string | null;
  recentMessages: string[];
}

export interface GeminiSummaryClient {
  models: {
    generateContent(input: { model: string; contents: string }): Promise<{ text?: string | null }>;
  };
}

export interface GenerateConversationSummaryInput extends SummaryPromptInput {
  model?: string;
  client?: GeminiSummaryClient;
}

function ok<T>(data: T): SummaryResult<T> {
  return { success: true, data };
}

function fail<T>(error: unknown): SummaryResult<T> {
  const message = error instanceof Error ? error.message : 'Unknown summary generation error';
  return { success: false, error: message };
}

/** Builds the prompt used to generate a compact conversation summary. */
export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const existing = input.existingSummary?.trim()
    ? input.existingSummary.trim()
    : 'Belum ada ringkasan sebelumnya.';
  const recent = input.recentMessages
    .map((message, index) => `${index + 1}. ${message}`)
    .join('\n');

  return [
    'You summarize only important conversation context for a long-running AI assistant.',
    '',
    'Instructions:',
    '- summarize only important conversation context',
    '- preserve unresolved user goals',
    '- preserve recent decisions',
    '- preserve important technical context',
    '- omit small talk',
    '- omit temporary emotional states unless relevant',
    '- keep it concise',
    '- write in Indonesian unless the conversation is mostly another language',
    '- output plain text only, not JSON',
    '',
    'Existing summary:',
    existing,
    '',
    'Recent messages:',
    recent || '(Tidak ada pesan terbaru.)',
    '',
    'Updated concise summary:',
  ].join('\n');
}

/** Extracts plain summary text from a Gemini response. */
export function parseSummaryResponse(responseText: string | null | undefined): string {
  return (responseText ?? '').trim();
}

/** Validates generated summary text before it is persisted. */
export function validateSummary(summary: string): boolean {
  return summary.trim().length > 0;
}

/** Generates a plain-text conversation summary using the existing Gemini client. */
export async function generateConversationSummary(
  input: GenerateConversationSummaryInput,
): Promise<SummaryResult<string>> {
  try {
    const client = input.client ?? ai;
    const response = await client.models.generateContent({
      model: input.model ?? SUMMARY_MODEL,
      contents: buildSummaryPrompt(input),
    });
    const summary = parseSummaryResponse(response.text);

    if (!validateSummary(summary)) {
      return fail(new Error('Generated summary was empty'));
    }

    return ok(summary);
  } catch (error) {
    return fail(error);
  }
}
