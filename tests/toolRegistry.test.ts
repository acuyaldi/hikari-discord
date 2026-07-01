import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearRegisteredTools,
  executeTool,
  getRegisteredTools,
  getTool,
  registerTool,
} from '../src/services/tools/toolRegistry';
import type { ToolDefinition } from '../src/services/tools/types';

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'echo',
    description: 'Echoes its input.',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
      required: ['value'],
    },
    execute: async (args: unknown) => ({ success: true, data: args }),
    ...overrides,
  };
}

test('registerTool stores and retrieves tool definitions', () => {
  clearRegisteredTools();
  const definition = tool();

  registerTool(definition);

  assert.deepEqual(getRegisteredTools(), [definition]);
  assert.equal(getTool('echo'), definition);
});

test('executeTool returns a successful result for known tools', async () => {
  clearRegisteredTools();
  registerTool(tool());

  const result = await executeTool('echo', { value: 'hello' });

  assert.deepEqual(result, { success: true, data: { value: 'hello' } });
});

test('executeTool returns a failure result for unknown tools', async () => {
  clearRegisteredTools();

  const result = await executeTool('missing', {});

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /missing/i);
});

test('executeTool catches tool failures and never throws', async () => {
  clearRegisteredTools();
  registerTool(
    tool({
      name: 'explode',
      execute: async () => {
        throw new Error('kaboom');
      },
    }),
  );

  const result = await executeTool('explode', {});

  assert.deepEqual(result, { success: false, error: 'kaboom' });
});
