/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUSUNKATA_GENERATION_PROMPT,
  generateWordBatch,
  getValidatedWordBatch,
} from '../src/services/games/susunkata/wordGenerator';

test('generateWordBatch parses a direct Gemini JSON batch with the requested count', async () => {
  const entries = await generateWordBatch(2, {
    directGenerate: async () =>
      JSON.stringify([
        { word: 'melati', clue: 'Bunga putih yang harum.' },
        { word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' },
      ]),
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { word: 'melati', clue: 'Bunga putih yang harum.' });
});

test('generateWordBatch falls back to provider router after two primary failures', async () => {
  let directCalls = 0;
  let providerCalls = 0;

  const entries = await generateWordBatch(1, {
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
        directGenerate: async () => '[{"word":"api","clue":"Benda panas."}]',
        providerGenerate: async () => '[{"word":"api","clue":"Benda panas."}]',
      }),
    /Invalid susunkata response/,
  );
});

test('getValidatedWordBatch retries smaller batches to fill rejected entries', async () => {
  const generatedCounts: number[] = [];
  const batches = [
    [
      { word: 'melati', clue: 'Bunga putih yang harum.' },
      { word: 'api', clue: 'Benda panas.' },
      { word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' },
    ],
    [{ word: 'kertas', clue: 'Lembaran tipis untuk menulis.' }],
  ];

  const entries = await getValidatedWordBatch(3, {
    generateBatch: async (count) => {
      generatedCounts.push(count);
      return batches.shift() ?? [];
    },
  });

  assert.deepEqual(generatedCounts, [3, 1]);
  assert.deepEqual(
    entries.map((entry) => entry.word),
    ['melati', 'sepeda', 'kertas'],
  );
});

test('getValidatedWordBatch returns partial entries and never throws on total generator failure', async () => {
  const entries = await getValidatedWordBatch(2, {
    generateBatch: async () => {
      throw new Error('ai unavailable');
    },
  });

  assert.deepEqual(entries, []);
});

test('susunkata generation prompt requests a single strict Indonesian JSON batch', () => {
  assert.match(SUSUNKATA_GENERATION_PROMPT, /SINGLE AI call/i);
  assert.match(SUSUNKATA_GENERATION_PROMPT, /Indonesian nouns\/verbs/i);
  assert.match(SUSUNKATA_GENERATION_PROMPT, /Return strictly as JSON/i);
});
