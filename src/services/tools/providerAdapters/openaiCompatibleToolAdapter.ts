import type {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
  ToolProviderAdapter,
  ToolResult,
} from '../types';

export interface OpenAICompatibleToolState {
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
}

interface OpenAICompatibleToolCall {
  id?: string;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
}

export interface OpenAICompatibleToolResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAICompatibleToolCall[];
    };
  }>;
}

export function toOpenAICompatibleTools(
  toolDefinitions: ToolDefinition[],
): Array<Record<string, unknown>> {
  return toolDefinitions.map((toolDefinition) => ({
    type: 'function',
    function: {
      name: toolDefinition.name,
      description: toolDefinition.description,
      parameters: toolDefinition.parameters,
    },
  }));
}

function parseArguments(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function parseOpenAICompatibleToolResponse(
  response: OpenAICompatibleToolResponse,
): ToolCallResponse {
  const message = response.choices?.[0]?.message;
  const toolCall = message?.tool_calls?.[0];
  if (!toolCall?.function) {
    return { text: message?.content ?? null, toolCall: null };
  }

  return {
    text: message?.content ?? null,
    toolCall: {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: parseArguments(toolCall.function.arguments),
    },
  };
}

export function appendOpenAICompatibleToolResult(
  state: OpenAICompatibleToolState,
  toolCall: ToolCallRequest,
  result: ToolResult,
): OpenAICompatibleToolState {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      },
    ],
  };
}

export const openAICompatibleToolAdapter: ToolProviderAdapter<
  OpenAICompatibleToolState,
  OpenAICompatibleToolResponse
> = {
  attachTools: (state, toolDefinitions) => ({
    ...state,
    tools: toOpenAICompatibleTools(toolDefinitions),
  }),
  parseResponse: parseOpenAICompatibleToolResponse,
  appendToolResult: appendOpenAICompatibleToolResult,
};
