/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { AIProviderName } from '../src/services/ai/types';
import { toolsForProvider } from '../src/services/tools/providerToolSelection';
import type { ToolDefinition } from '../src/services/tools/types';

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ success: true, data: null }),
  };
}

test('toolsForProvider excludes web_search for Gemini and keeps other tools', () => {
  const selected = toolsForProvider(AIProviderName.GEMINI, [
    tool('calculate'),
    tool('web_search'),
  ]);

  assert.deepEqual(
    selected.map((definition) => definition.name),
    ['calculate'],
  );
});

test('toolsForProvider includes web_search for Groq and OpenRouter', () => {
  const tools = [tool('calculate'), tool('web_search')];

  assert.deepEqual(
    toolsForProvider(AIProviderName.GROQ, tools).map((definition) => definition.name),
    ['calculate', 'web_search'],
  );
  assert.deepEqual(
    toolsForProvider(AIProviderName.OPENROUTER, tools).map((definition) => definition.name),
    ['calculate', 'web_search'],
  );
});
