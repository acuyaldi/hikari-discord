import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSummaryPrompt,
  generateConversationSummary,
  parseSummaryResponse,
  validateSummary,
} from '../src/services/summary/summaryGenerator';

test('buildSummaryPrompt includes summary instructions and recent messages', () => {
  const prompt = buildSummaryPrompt({
    existingSummary: 'Existing project context.',
    recentMessages: ['User wants a TypeScript refactor.', 'Decision: keep tests first.'],
  });

  assert.match(prompt, /summarize only important conversation context/i);
  assert.match(prompt, /preserve unresolved user goals/i);
  assert.match(prompt, /write in Indonesian/i);
  assert.match(prompt, /Existing project context/);
  assert.match(prompt, /User wants a TypeScript refactor/);
});

test('parseSummaryResponse trims plain text', () => {
  assert.equal(parseSummaryResponse('\n  Ringkasan penting.  \n'), 'Ringkasan penting.');
});

test('validateSummary rejects empty summaries', () => {
  assert.equal(validateSummary(''), false);
  assert.equal(validateSummary('   '), false);
  assert.equal(validateSummary('Ringkasan valid.'), true);
});

test('generateConversationSummary uses injected Gemini client and rejects empty response', async () => {
  const summary = await generateConversationSummary({
    existingSummary: null,
    recentMessages: ['Halo, tolong lanjutkan task ini.'],
    model: 'test-model',
    client: {
      models: {
        generateContent: async ({ model, contents }: { model: string; contents: string }) => {
          assert.equal(model, 'test-model');
          assert.match(contents, /Halo/);
          return { text: ' Ringkasan valid. ' };
        },
      },
    },
  });

  assert.equal(summary.success, true);
  assert.equal(summary.success ? summary.data : '', 'Ringkasan valid.');

  const empty = await generateConversationSummary({
    existingSummary: null,
    recentMessages: ['Halo'],
    client: {
      models: {
        generateContent: async () => ({ text: '   ' }),
      },
    },
  });

  assert.equal(empty.success, false);
});
