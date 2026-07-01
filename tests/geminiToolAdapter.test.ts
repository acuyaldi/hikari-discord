/// <reference types="node" />

import assert from 'assert/strict';
import test from 'node:test';

import {
  appendGeminiToolResult,
  parseGeminiToolResponse,
  toGeminiTools,
} from '../src/services/tools/providerAdapters/geminiToolAdapter';
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

test('toGeminiTools converts tool definitions into functionDeclarations', () => {
  const tools = toGeminiTools([mockTool]);

  assert.deepEqual(tools, [
    {
      functionDeclarations: [
        {
          name: 'lookupWeather',
          description: 'Looks up weather by city.',
          parametersJsonSchema: mockTool.parameters,
        },
      ],
    },
  ]);
});

test('parseGeminiToolResponse extracts function calls from functionCalls', () => {
  const parsed = parseGeminiToolResponse({
    text: null,
    functionCalls: [
      {
        id: 'call-1',
        name: 'lookupWeather',
        args: { city: 'Bandung' },
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

test('appendGeminiToolResult appends a functionResponse turn', () => {
  const nextState = appendGeminiToolResult(
    {
      contents: [{ role: 'user', parts: [{ text: 'What is the weather?' }] }],
    },
    {
      id: 'call-1',
      name: 'lookupWeather',
      arguments: { city: 'Bandung' },
    },
    { success: true, data: { forecast: 'sunny' } },
  );

  assert.deepEqual(nextState.contents[1], {
    role: 'model',
    parts: [
      {
        functionCall: {
          name: 'lookupWeather',
          id: 'call-1',
          args: { city: 'Bandung' },
        },
      },
    ],
  });
  assert.deepEqual(nextState.contents[2], {
    role: 'tool',
    parts: [
      {
        functionResponse: {
          name: 'lookupWeather',
          id: 'call-1',
          response: { success: true, data: { forecast: 'sunny' } },
        },
      },
    ],
  });
});
