/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { scrambleWord } from '../src/services/games/susunkata/scrambler';

function sortedLetters(value: string): string[] {
  return value.replace(/-/g, '').split('').sort();
}

test('scrambleWord returns uppercase letters separated by hyphens', () => {
  assert.match(scrambleWord('merdeka'), /^[A-Z](?:-[A-Z])*$/);
});

test('scrambleWord preserves exactly the original letters', () => {
  const scrambled = scrambleWord('merdeka');

  assert.deepEqual(sortedLetters(scrambled), 'MERDEKA'.split('').sort());
});

test('scrambleWord does not return the original word order for normal words', () => {
  assert.notEqual(scrambleWord('abcdef'), 'A-B-C-D-E-F');
});

test('scrambleWord handles repetitive words without looping forever', () => {
  assert.equal(scrambleWord('aaaaa'), 'A-A-A-A-A');
});
