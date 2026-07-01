/// <reference types="node" />

import assert from 'assert/strict';
import test from 'node:test';

import { calculatorTool } from '../src/services/tools/implementations/calculatorTool';

test('calculatorTool evaluates valid mathematical expressions', async () => {
  const result = await calculatorTool.execute({ expression: 'sqrt(16) + 2^3' });

  assert.equal(result.success, true);
  assert.equal(result.data, '12');
});

test('calculatorTool handles malformed input without throwing', async () => {
  const result = await calculatorTool.execute({ expression: '2 +' });

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /calculate|invalid|malformed|unexpected/i);
});

test('calculatorTool rejects unsafe parser access without executing it', async () => {
  const result = await calculatorTool.execute({ expression: 'import({ evil: 1 })' });

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /disabled|not allowed|calculate/i);
});

test('calculatorTool validates expression argument shape', async () => {
  const result = await calculatorTool.execute({ expression: 123 });

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /expression/i);
});
