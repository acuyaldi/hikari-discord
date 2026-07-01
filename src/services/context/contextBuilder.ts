import { DEBUG_SUMMARY, SUMMARY_MAX_CONTEXT_LENGTH } from '../../config/env';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  authorName?: string;
  id?: string;
}

export interface FinalContextInput {
  systemPrompt: string;
  dynamicPrompt?: string | null;
  longTermMemory?: string | null;
  conversationSummary?: string | null;
  recentMessages?: ChatMessage[];
  currentUserMessage: string;
}

export interface FinalContextResult {
  dynamicSystemInstruction: string;
  finalPrompt: string;
}

interface SummaryFormatOptions {
  maxLength?: number;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function joinSections(sections: Array<string | null | undefined>): string {
  return sections
    .map((section) => cleanText(section))
    .filter((section): section is string => section !== null)
    .join('\n');
}

function formatRecentMessage(message: ChatMessage): string | null {
  const content = cleanText(message.content);
  if (content === null) return null;
  const label = message.authorName
    ? `@${message.authorName}`
    : message.role === 'assistant' ? 'Hikari' : 'User';
  return `${label}: ${content}`;
}

function formatRecentMessages(messages: ChatMessage[]): string | null {
  const formatted = messages
    .map(formatRecentMessage)
    .filter((message): message is string => message !== null);

  if (formatted.length === 0) return null;
  return `Percakapan terbaru:\n${formatted.join('\n')}`;
}

function debugContextBuilder(details: {
  summaryPresent: boolean;
  rawSummaryLength: number;
  formattedSummaryLength: number;
  estimatedTokens: number;
  layers: string[];
}): void {
  if (!DEBUG_SUMMARY) return;

  console.log(
    [
      '[Context Builder]',
      `summary present: ${details.summaryPresent}`,
      `raw summary length: ${details.rawSummaryLength}`,
      `formatted summary length: ${details.formattedSummaryLength}`,
      `estimated tokens: ${details.estimatedTokens}`,
      `layers included: ${details.layers.join(', ') || '-'}`,
    ].join('\n'),
  );
}

/** Estimates prompt tokens with a cheap character-based approximation. */
export function estimateContextTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/** Formats a stored conversation summary for insertion into the user prompt context. */
export function formatSummaryForPrompt(
  summary: string | null | undefined,
  options: SummaryFormatOptions = {},
): string | null {
  const cleaned = cleanText(summary);
  if (cleaned === null) return null;

  const maxLength = options.maxLength ?? SUMMARY_MAX_CONTEXT_LENGTH;
  const boundedSummary =
    cleaned.length > maxLength ? cleaned.slice(Math.max(0, cleaned.length - maxLength)) : cleaned;

  if (DEBUG_SUMMARY && cleaned.length > maxLength) {
    console.log(
      `[Context Builder]\nsummary truncated from ${cleaned.length} to ${boundedSummary.length} characters`,
    );
  }

  return `Ringkasan percakapan sebelumnya: ${boundedSummary}`;
}

/** Appends a formatted summary section to an existing prompt section when available. */
export function injectSummarySection(
  baseContext: string,
  summary: string | null | undefined,
  options: SummaryFormatOptions = {},
): string {
  const formattedSummary = formatSummaryForPrompt(summary, options);
  if (formattedSummary === null) return baseContext;

  const cleanedBase = cleanText(baseContext);
  if (cleanedBase === null) return formattedSummary;
  return `${cleanedBase}\n\n${formattedSummary}`;
}

/** Builds the final prompt context expected by ProviderManager without throwing. */
export function buildFinalContext(input: FinalContextInput): FinalContextResult {
  try {
    const formattedSummary = formatSummaryForPrompt(input.conversationSummary);
    const recentContext = formatRecentMessages(input.recentMessages ?? []);
    const dynamicSections = [
      input.systemPrompt,
      input.dynamicPrompt,
      input.longTermMemory,
      formattedSummary,
    ];
    const finalPrompt = joinSections([recentContext, input.currentUserMessage]);
    const dynamicSystemInstruction = joinSections(dynamicSections);
    const layers = [
      cleanText(input.systemPrompt) !== null ? 'system' : null,
      cleanText(input.dynamicPrompt) !== null ? 'dynamic' : null,
      cleanText(input.longTermMemory) !== null ? 'longTermMemory' : null,
      formattedSummary !== null ? 'summary' : null,
      recentContext !== null ? 'recentMessages' : null,
      cleanText(input.currentUserMessage) !== null ? 'currentUserMessage' : null,
    ].filter((layer): layer is string => layer !== null);
    const combinedContext = `${dynamicSystemInstruction}\n${finalPrompt}`;

    debugContextBuilder({
      summaryPresent: formattedSummary !== null,
      rawSummaryLength:
        typeof input.conversationSummary === 'string' ? input.conversationSummary.trim().length : 0,
      formattedSummaryLength: formattedSummary?.length ?? 0,
      estimatedTokens: estimateContextTokens(combinedContext),
      layers,
    });

    return { dynamicSystemInstruction, finalPrompt };
  } catch (error) {
    if (DEBUG_SUMMARY) {
      console.error('[Context Builder]\nfailed to build full context, falling back:', error);
    }

    return {
      dynamicSystemInstruction: joinSections([
        input.systemPrompt,
        input.dynamicPrompt,
        input.longTermMemory,
      ]),
      finalPrompt: cleanText(input.currentUserMessage) ?? '',
    };
  }
}
