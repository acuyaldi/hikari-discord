import {
  DEBUG_AI,
  TAVILY_API_KEY,
  WEB_SEARCH_MAX_RESULTS,
} from '../../config/env';
import { calculatorTool } from './implementations/calculatorTool';
import { createWebSearchTool } from './implementations/webSearchTool';
import { registerTool } from './toolRegistry';

interface RegisterDefaultToolsOptions {
  tavilyApiKey?: string;
  webSearchMaxResults?: number;
}

export function registerDefaultTools(options: RegisterDefaultToolsOptions = {}): void {
  registerTool(calculatorTool);

  const tavilyApiKey = options.tavilyApiKey ?? TAVILY_API_KEY;
  if (!tavilyApiKey) {
    if (DEBUG_AI) {
      console.warn('[Tools] web_search not registered: TAVILY_API_KEY not configured');
    }
    return;
  }

  if (DEBUG_AI) {
    console.log('[Tools] web_search registered: TAVILY_API_KEY configured');
  }

  registerTool(
    createWebSearchTool({
      apiKey: tavilyApiKey,
      maxResults: options.webSearchMaxResults ?? WEB_SEARCH_MAX_RESULTS,
    }),
  );
}
