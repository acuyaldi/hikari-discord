/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateWordBatch,
  validateWordEntry,
} from '../src/services/games/susunkata/wordValidator';

test('validateWordEntry accepts a valid Indonesian word and clue', () => {
  const result = validateWordEntry({
    word: 'melati',
    clue: 'Bunga putih yang sering dipakai untuk hiasan.',
  });

  assert.equal(result.valid, true);
});

test('validateWordEntry rejects words outside configured length bounds', () => {
  assert.equal(validateWordEntry({ word: 'api', clue: 'Benda panas.' }).valid, false);
  assert.equal(
    validateWordEntry({ word: 'pertanggungjawaban', clue: 'Sikap siap menerima akibat.' }).valid,
    false,
  );
});

test('validateWordEntry rejects empty and non alphabetic words', () => {
  assert.equal(validateWordEntry({ word: '   ', clue: 'Kosong.' }).valid, false);
  assert.equal(validateWordEntry({ word: 'meja2', clue: 'Tempat menaruh barang.' }).valid, false);
  assert.equal(validateWordEntry({ word: 'rumah besar', clue: 'Tempat tinggal.' }).valid, false);
});

test('validateWordEntry rejects empty clues and clues containing the answer', () => {
  assert.equal(validateWordEntry({ word: 'pisang', clue: '' }).valid, false);
  assert.equal(
    validateWordEntry({ word: 'pisang', clue: 'Buah pisang berwarna kuning.' }).valid,
    false,
  );
});

test('validateWordEntry rejects words in the basic offensive blocklist', () => {
  assert.equal(validateWordEntry({ word: 'anjing', clue: 'Hewan peliharaan.' }).valid, false);
});

test('validateWordEntry rejects clues containing offensive blocklist words', () => {
  assert.equal(validateWordEntry({ word: 'melati', clue: 'Clue bangsat.' }).valid, false);
});

test('validateWordBatch separates valid and rejected entries and rejects duplicate words', () => {
  const result = validateWordBatch([
    { word: 'melati', clue: 'Bunga putih yang harum.' },
    { word: 'sepeda', clue: 'Kendaraan roda dua tanpa mesin.' },
    { word: 'MELATI', clue: 'Tanaman hias berbunga putih.' },
    { word: 'meja2', clue: 'Tempat menaruh barang.' },
  ]);

  assert.deepEqual(
    result.valid.map((entry) => entry.word),
    ['melati', 'sepeda'],
  );
  assert.deepEqual(
    result.rejected.map((entry) => entry.word),
    ['MELATI', 'meja2'],
  );
});
