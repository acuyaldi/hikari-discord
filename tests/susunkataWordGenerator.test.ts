/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUSUNKATA_GENERATION_PROMPT,
  generateWordBatch,
  getValidatedWordBatch,
  selectRandomWords,
} from '../src/services/games/susunkata/wordGenerator';

test('generateWordBatch asks AI for clues for selected words only', async () => {
  let promptSeen = '';
  const entries = await generateWordBatch(2, {
    selectWords: () => ['melati', 'sepeda'],
    directGenerate: async (_count, prompt) => {
      promptSeen = prompt;
      return JSON.stringify([
        { word: 'melati', clue: 'Bunga putih yang harum.' },
        { word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' },
      ]);
    },
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { word: 'melati', clue: 'Bunga putih yang harum.' });
  assert.match(promptSeen, /melati/);
  assert.match(promptSeen, /sepeda/);
  assert.doesNotMatch(promptSeen, /Generate exactly/i);
  assert.match(promptSeen, /buatkan satu clue singkat/i);
});

test('generateWordBatch falls back to provider router after two primary failures', async () => {
  let directCalls = 0;
  let providerCalls = 0;

  const entries = await generateWordBatch(1, {
    selectWords: () => ['sepeda'],
    directGenerate: async () => {
      directCalls += 1;
      throw new Error('primary unavailable');
    },
    providerGenerate: async () => {
      providerCalls += 1;
      return '[{"word":"sepeda","clue":"Kendaraan roda dua tanpa mesin."}]';
    },
  });

  assert.equal(directCalls, 2);
  assert.equal(providerCalls, 1);
  assert.deepEqual(entries, [{ word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' }]);
});

test('generateWordBatch validates parsed response shape', async () => {
  await assert.rejects(
    () =>
      generateWordBatch(1, {
        selectWords: () => ['sepeda'],
        directGenerate: async () => '[{"word":"api","clue":"Benda panas."}]',
        providerGenerate: async () => '[{"word":"api","clue":"Benda panas."}]',
        clueRetryLimit: 0,
        substituteWords: () => [],
      }),
    /Invalid susunkata response/,
  );
});

test('selectRandomWords is exported for direct sampling checks', () => {
  assert.equal(selectRandomWords(3).length, 3);
});

test('getValidatedWordBatch retries clue generation for a word whose clue leaks the answer', async () => {
  const prompts: string[] = [];

  const entries = await getValidatedWordBatch(3, {
    selectWords: () => ['melati', 'sepeda', 'kertas'],
    directGenerate: async (_count, prompt) => {
      prompts.push(prompt);
      if (prompt.includes('melati') && prompt.includes('sepeda')) {
        return JSON.stringify([
          { word: 'melati', clue: 'Bunga melati yang harum.' },
          { word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' },
          { word: 'kertas', clue: 'Lembaran tipis untuk menulis.' },
        ]);
      }
      return JSON.stringify([{ word: 'melati', clue: 'Bunga putih yang harum.' }]);
    },
  });

  assert.equal(prompts.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.word),
    ['melati', 'sepeda', 'kertas'],
  );
  assert.equal(entries[0]?.clue, 'Bunga putih yang harum.');
});

test('getValidatedWordBatch returns partial entries and never throws on total generator failure', async () => {
  const entries = await getValidatedWordBatch(2, {
    selectWords: () => ['melati', 'sepeda'],
    directGenerate: async () => {
      throw new Error('ai unavailable');
    },
    providerGenerate: async () => {
      throw new Error('provider unavailable');
    },
  });

  assert.deepEqual(entries, []);
});

test('susunkata generation prompt limits AI to clue generation for fixed words', () => {
  assert.match(SUSUNKATA_GENERATION_PROMPT, /Untuk setiap kata berikut/i);
  assert.match(SUSUNKATA_GENERATION_PROMPT, /urutan kata yang sama/i);
  assert.match(SUSUNKATA_GENERATION_PROMPT, /Return strictly as JSON/i);
  assert.doesNotMatch(SUSUNKATA_GENERATION_PROMPT, /Generate exactly/i);
});
