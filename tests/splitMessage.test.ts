/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { splitMessage } from '../src/utils/splitmessage';

test('splitMessage keeps every chunk within the configured limit', () => {
  const chunks = splitMessage('Header\n' + 'a'.repeat(4_500), 2_000);

  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 2_000));
  assert.equal(chunks.join(''), 'Header\n' + 'a'.repeat(4_500) + '\n');
});

test('splitMessage does not emit empty chunks when a line exceeds the limit', () => {
  const chunks = splitMessage('x'.repeat(2_100), 2_000);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.length, 2_000);
  assert.equal(chunks[1]?.length, 101);
  assert.ok(chunks.every((chunk) => chunk.length > 0));
});