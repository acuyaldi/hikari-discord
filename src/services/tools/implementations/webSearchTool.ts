import { TAVILY_API_KEY, WEB_SEARCH_MAX_RESULTS } from '../../../config/env';
import type { ToolDefinition, ToolResult } from '../types';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

interface CreateWebSearchToolOptions {
  apiKey?: string;
  maxResults?: number;
  fetchImpl?: FetchLike;
}

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  link?: unknown;
  content?: unknown;
  snippet?: unknown;
  score?: unknown;
  published_date?: unknown;
}

interface TavilyResponse {
  answer?: unknown;
  results?: unknown;
}

function fail(error: string): ToolResult {
  return { success: false, error };
}

function getQuery(args: unknown): string | null {
  if (typeof args !== 'object' || args === null || !('query' in args)) return null;
  const query = (args as { query?: unknown }).query;
  return typeof query === 'string' ? query.trim() : null;
}

function normalizeMaxResults(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 5;
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function resultString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseTavilyResponse(response: TavilyResponse, query: string, maxResults: number): unknown {
  const rawResults = Array.isArray(response.results) ? response.results : [];
  const results = rawResults
    .slice(0, maxResults)
    .map((raw): Record<string, unknown> | null => {
      if (typeof raw !== 'object' || raw === null) return null;
      const result = raw as TavilyResult;
      const title = resultString(result.title) ?? 'Untitled result';
      const url = resultString(result.url) ?? resultString(result.link);
      const content = resultString(result.content) ?? resultString(result.snippet) ?? '';
      if (!url) return null;

      return {
        title,
        url,
        content,
        ...(typeof result.score === 'number' ? { score: result.score } : {}),
        ...(resultString(result.published_date)
          ? { publishedDate: resultString(result.published_date) }
          : {}),
      };
    })
    .filter((result): result is Record<string, unknown> => result !== null);

  return {
    query,
    ...(resultString(response.answer) ? { answer: resultString(response.answer) } : {}),
    results,
  };
}

async function readErrorBody(response: { text?: () => Promise<string> }): Promise<string> {
  try {
    return response.text ? await response.text() : '';
  } catch {
    return '';
  }
}

export function createWebSearchTool(
  options: CreateWebSearchToolOptions = {},
): ToolDefinition {
  const apiKey = options.apiKey ?? TAVILY_API_KEY;
  const maxResults = normalizeMaxResults(options.maxResults ?? WEB_SEARCH_MAX_RESULTS);
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return {
    name: 'web_search',
    description: 'Search the web for current information.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The web search query to run.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (args: unknown): Promise<ToolResult> => {
      const query = getQuery(args);
      if (!query) return fail('A non-empty string query is required.');
      if (!apiKey) return fail('Tavily API key is not configured.');
      if (!fetchImpl) return fail('Fetch API is not available for Tavily search.');

      try {
        const response = await fetchImpl(TAVILY_SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: 'basic',
            max_results: maxResults,
          }),
        });

        if (!response.ok) {
          const body = await readErrorBody(response);
          return fail(
            `Tavily search failed with HTTP ${response.status}${body ? `: ${body}` : ''}`,
          );
        }

        const payload = response.json ? await response.json() : {};
        return {
          success: true,
          data: parseTavilyResponse(payload as TavilyResponse, query, maxResults),
        };
      } catch (error) {
        return fail(
          `Tavily search failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

export const webSearchTool = createWebSearchTool();

