/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMON_WORDS } from '../src/services/games/susunkata/commonWords';
import { selectRandomWords } from '../src/services/games/susunkata/wordGenerator';

test('COMMON_WORDS has enough curated variety and no duplicates', () => {
  assert.equal(COMMON_WORDS.length >= 150, true);
  assert.equal(new Set(COMMON_WORDS).size, COMMON_WORDS.length);
});

test('COMMON_WORDS entries are 5-9 lowercase alphabetic letters', () => {
  for (const word of COMMON_WORDS) {
    assert.match(word, /^[a-z]+$/);
    assert.equal(word.length >= 5, true, `${word} is too short`);
    assert.equal(word.length <= 9, true, `${word} is too long`);
  }
});

test('selectRandomWords returns distinct words with the requested count', () => {
  const words = selectRandomWords(20);

  assert.equal(words.length, 20);
  assert.equal(new Set(words).size, words.length);
  assert.equal(words.every((word) => COMMON_WORDS.includes(word)), true);
});

test('selectRandomWords returns as many as available when count exceeds list length', () => {
  const words = selectRandomWords(COMMON_WORDS.length + 50);

  assert.equal(words.length, COMMON_WORDS.length);
  assert.equal(new Set(words).size, COMMON_WORDS.length);
});
