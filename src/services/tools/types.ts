export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown) => Promise<ToolResult>;
}

export interface ToolCallRequest {
  id?: string;
  name: string;
  arguments: unknown;
}

export interface ToolCallResponse {
  text: string | null;
  toolCall?: ToolCallRequest | null;
}

export interface ToolProviderAdapter<TState, TRawResponse> {
  attachTools: (state: TState, toolDefinitions: ToolDefinition[]) => TState;
  parseResponse: (response: TRawResponse) => ToolCallResponse;
  appendToolResult: (
    state: TState,
    toolCall: ToolCallRequest,
    result: ToolResult,
  ) => TState;
}

export type ToolProviderCall<TState, TRawResponse> = (
  state: TState,
) => Promise<TRawResponse>;
