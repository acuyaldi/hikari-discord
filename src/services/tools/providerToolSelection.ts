import { AIProviderName } from '../ai/types';
import type { ToolDefinition } from './types';

const GEMINI_EXCLUDED_TOOLS = new Set(['web_search']);

export function toolsForProvider(
  providerName: AIProviderName,
  tools: ToolDefinition[] | undefined,
): ToolDefinition[] {
  if (!tools || tools.length === 0) return [];

  if (providerName === AIProviderName.GEMINI) {
    return tools.filter((tool) => !GEMINI_EXCLUDED_TOOLS.has(tool.name));
  }

  return tools;
}

