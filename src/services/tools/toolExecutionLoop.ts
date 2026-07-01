import {
  TOOL_MAX_ITERATIONS,
} from '../../config/env';
import { executeTool as executeRegisteredTool } from './toolRegistry';
import type {
  ToolDefinition,
  ToolProviderAdapter,
  ToolProviderCall,
  ToolResult,
} from './types';

export const TOOL_LOOP_FALLBACK_MESSAGE =
  'Tool loop was unable to finish cleanly or reached the iteration limit, so here is the best available response.';

export interface RunWithToolsOptions<TState, TRawResponse> {
  initialState: TState;
  providerCall: ToolProviderCall<TState, TRawResponse>;
  adapter: ToolProviderAdapter<TState, TRawResponse>;
  toolDefinitions: ToolDefinition[];
  maxIterations?: number;
  executeTool?: (name: string, args: unknown) => Promise<ToolResult>;
}

function finalText(bestText: string | null): string {
  return bestText?.trim() ? bestText : TOOL_LOOP_FALLBACK_MESSAGE;
}

export async function runWithTools<TState, TRawResponse>(
  options: RunWithToolsOptions<TState, TRawResponse>,
): Promise<string> {
  const executeTool = options.executeTool ?? executeRegisteredTool;
  let state = options.adapter.attachTools(options.initialState, options.toolDefinitions);
  let bestText: string | null = null;

  try {
    for (let index = 0; index < (options.maxIterations ?? TOOL_MAX_ITERATIONS); index += 1) {
      const response = await options.providerCall(state);
      const parsed = options.adapter.parseResponse(response);

      if (parsed.text?.trim()) bestText = parsed.text;
      if (!parsed.toolCall) return finalText(bestText);

      const result = await executeTool(parsed.toolCall.name, parsed.toolCall.arguments);
      state = options.adapter.appendToolResult(state, parsed.toolCall, result);
      state = options.adapter.attachTools(state, options.toolDefinitions);
    }
  } catch {
    return finalText(bestText);
  }

  return finalText(bestText);
}
