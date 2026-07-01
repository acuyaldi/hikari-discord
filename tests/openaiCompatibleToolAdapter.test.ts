/// <reference types="node" />

import assert from 'assert/strict';
import test from 'node:test';

import {
  appendOpenAICompatibleToolResult,
  parseOpenAICompatibleToolResponse,
  toOpenAICompatibleTools,
} from '../src/services/tools/providerAdapters/openaiCompatibleToolAdapter';
import type { ToolDefinition } from '../src/services/tools/types';

const mockTool: ToolDefinition = {
  name: 'lookupWeather',
  description: 'Looks up weather by city.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string' },
    },
    required: ['city'],
  },
  execute: async () => ({ success: true, data: { city: 'Jakarta' } }),
};

test('toOpenAICompatibleTools converts tool definitions into function tools', () => {
  const tools = toOpenAICompatibleTools([mockTool]);

  assert.deepEqual(tools, [
    {
      type: 'function',
      function: {
        name: 'lookupWeather',
        description: 'Looks up weather by city.',
        parameters: mockTool.parameters,
      },
    },
  ]);
});

test('parseOpenAICompatibleToolResponse extracts tool_calls from assistant messages', () => {
  const parsed = parseOpenAICompatibleToolResponse({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'lookupWeather',
                arguments: '{"city":"Bandung"}',
              },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(parsed, {
    text: null,
    toolCall: {
      id: 'call-1',
      name: 'lookupWeather',
      arguments: { city: 'Bandung' },
    },
  });
});

test('appendOpenAICompatibleToolResult appends a tool message with serialized output', () => {
  const nextState = appendOpenAICompatibleToolResult(
    {
      messages: [{ role: 'user', content: 'What is the weather?' }],
    },
    {
      id: 'call-1',
      name: 'lookupWeather',
      arguments: { city: 'Bandung' },
    },
    { success: true, data: { forecast: 'sunny' } },
  );

  assert.deepEqual(nextState.messages[1], {
    role: 'tool',
    tool_call_id: 'call-1',
    content: '{"success":true,"data":{"forecast":"sunny"}}',
  });
});
