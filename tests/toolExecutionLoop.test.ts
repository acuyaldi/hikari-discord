import assert from 'node:assert/strict';
import test from 'node:test';

import { runWithTools } from '../src/services/tools/toolExecutionLoop';
import { clearRegisteredTools, registerTool } from '../src/services/tools/toolRegistry';
import type {
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
  ToolProviderAdapter,
  ToolProviderCall,
} from '../src/services/tools/types';

interface MockState {
  turns: string[];
}

interface MockResponse {
  text: string | null;
  toolCall?: ToolCallRequest | null;
}

const adapter: ToolProviderAdapter<MockState, MockResponse> = {
  attachTools: (state) => state,
  parseResponse: (response) => ({
    text: response.text,
    toolCall: response.toolCall ?? null,
  }),
  appendToolResult: (state, toolCall, result) => ({
    turns: [...state.turns, `${toolCall.name}:${JSON.stringify(result)}`],
  }),
};

function providerCall(responses: MockResponse[]): ToolProviderCall<MockState, MockResponse> {
  let index = 0;
  return async () => {
    const response = responses[index] ?? responses[responses.length - 1];
    index += 1;
    return response;
  };
}

const pingTool: ToolDefinition = {
  name: 'ping',
  description: 'Returns pong.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => ({ success: true, data: 'pong' }),
};

test('runWithTools completes a full request -> tool -> follow-up -> final response cycle', async () => {
  clearRegisteredTools();
  registerTool(pingTool);

  const result = await runWithTools({
    initialState: { turns: ['user:hello'] },
    providerCall: providerCall([
      {
        text: null,
        toolCall: { id: 'call-1', name: 'ping', arguments: {} },
      },
      {
        text: 'All done.',
      },
    ]),
    adapter,
    toolDefinitions: [pingTool],
  });

  assert.equal(result, 'All done.');
});

test('runWithTools respects the maxIterations cap', async () => {
  clearRegisteredTools();
  registerTool(pingTool);

  const result = await runWithTools({
    initialState: { turns: ['user:hello'] },
    providerCall: providerCall([
      {
        text: null,
        toolCall: { id: 'call-1', name: 'ping', arguments: {} },
      },
      {
        text: null,
        toolCall: { id: 'call-2', name: 'ping', arguments: {} },
      },
      {
        text: 'Should never be reached.',
      },
    ]),
    adapter,
    toolDefinitions: [pingTool],
    maxIterations: 1,
  });

  assert.match(result, /unable to finish|iteration/i);
});

test('runWithTools keeps going when tool execution fails and returns a final response', async () => {
  clearRegisteredTools();
  registerTool({
    ...pingTool,
    name: 'explode',
    execute: async () => {
      throw new Error('tool failed');
    },
  });

  const result = await runWithTools({
    initialState: { turns: ['user:hello'] },
    providerCall: providerCall([
      {
        text: null,
        toolCall: { id: 'call-1', name: 'explode', arguments: {} },
      },
      {
        text: 'Fallback answer after tool failure.',
      },
    ]),
    adapter,
    toolDefinitions: [
      {
        ...pingTool,
        name: 'explode',
        execute: async () => ({ success: false, error: 'tool failed' }),
      },
    ],
  });

  assert.equal(result, 'Fallback answer after tool failure.');
});
