import type {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
  ToolProviderAdapter,
  ToolResult,
} from '../types';

export interface GeminiToolState {
  contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  config?: Record<string, unknown>;
}

interface GeminiFunctionCall {
  id?: string;
  name: string;
  args?: unknown;
}

interface GeminiToolResponseCandidate {
  content?: {
    parts?: Array<{
      text?: string;
      functionCall?: GeminiFunctionCall;
    }>;
  };
}

export interface GeminiToolResponse {
  text?: string | null;
  functionCalls?: GeminiFunctionCall[] | null;
  candidates?: GeminiToolResponseCandidate[] | null;
}

export function toGeminiTools(toolDefinitions: ToolDefinition[]): Array<Record<string, unknown>> {
  return toolDefinitions.map((toolDefinition) => ({
    functionDeclarations: [
      {
        name: toolDefinition.name,
        description: toolDefinition.description,
        parametersJsonSchema: toolDefinition.parameters,
      },
    ],
  }));
}

export function parseGeminiToolResponse(response: GeminiToolResponse): ToolCallResponse {
  const topLevelCall = response.functionCalls?.[0];
  if (topLevelCall) {
    return {
      text: response.text ?? null,
      toolCall: {
        id: topLevelCall.id,
        name: topLevelCall.name,
        arguments: topLevelCall.args ?? {},
      },
    };
  }

  const partCall = response.candidates?.[0]?.content?.parts?.find((part) => part.functionCall)?.functionCall;
  if (partCall) {
    return {
      text: response.text ?? null,
      toolCall: {
        id: partCall.id,
        name: partCall.name,
        arguments: partCall.args ?? {},
      },
    };
  }

  return { text: response.text ?? null, toolCall: null };
}

export function appendGeminiToolResult(
  state: GeminiToolState,
  toolCall: ToolCallRequest,
  result: ToolResult,
): GeminiToolState {
  return {
    ...state,
    contents: [
      ...state.contents,
      {
        role: 'tool',
        parts: [
          {
            functionResponse: {
              name: toolCall.name,
              id: toolCall.id,
              response: result,
            },
          },
        ],
      },
    ],
  };
}

export const geminiToolAdapter: ToolProviderAdapter<GeminiToolState, GeminiToolResponse> = {
  attachTools: (state, toolDefinitions) => ({
    ...state,
    config: {
      ...state.config,
      tools: toGeminiTools(toolDefinitions),
    },
  }),
  parseResponse: parseGeminiToolResponse,
  appendToolResult: appendGeminiToolResult,
};
