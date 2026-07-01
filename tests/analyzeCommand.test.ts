/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { boundAnalysisSource, describeAnalyzeEngine } from '../src/commands/analyze';
import { AIProviderName } from '../src/services/ai/types';
import { estimateContextTokens } from '../src/services/context/contextBuilder';

test('boundAnalysisSource leaves short content unchanged', () => {
  const source = '[FILE: note.txt]\nHalo dunia';

  assert.equal(boundAnalysisSource(source, 'Ringkas isi file ini'), source);
});

test('boundAnalysisSource trims oversized content to the prompt budget', () => {
  const source = `[FILE: big.pdf]\n${'A'.repeat(30_000)}\n${'Z'.repeat(8_000)}`;

  const bounded = boundAnalysisSource(source, 'Jelaskan isi PDF ini');

  assert.notEqual(bounded, source);
  assert.match(bounded, /konten dipotong agar muat diproses model/i);
  assert.ok(bounded.includes('A'.repeat(200)));
  assert.ok(bounded.includes('Z'.repeat(200)));
  assert.ok(estimateContextTokens(bounded) <= 4_000 - estimateContextTokens('Jelaskan isi PDF ini') - 250 + 20);
});

test('describeAnalyzeEngine reports deep-mode fallback labels clearly', () => {
  assert.match(describeAnalyzeEngine('mendalam', AIProviderName.GROQ), /120B/);
  assert.match(describeAnalyzeEngine('mendalam', AIProviderName.OPENROUTER, true), /OpenRouter/);
  assert.match(describeAnalyzeEngine('mendalam', AIProviderName.GEMINI, true), /Fallback/);
});