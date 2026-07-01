import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFinalContext,
  estimateContextTokens,
  formatSummaryForPrompt,
  injectSummarySection,
} from '../src/services/context/contextBuilder';

test('all layers are assembled in the target order', () => {
  const context = buildFinalContext({
    systemPrompt: 'System Prompt',
    dynamicPrompt: 'Dynamic Prompt',
    longTermMemory: '[Long-Term Memory]',
    conversationSummary: 'Keputusan sebelumnya: gunakan TypeScript.',
    recentMessages: [
      { role: 'user', content: 'Pesan lama user.' },
      { role: 'assistant', content: 'Balasan lama.' },
    ],
    currentUserMessage: 'Pesan saat ini.',
  });

  const combined = `${context.dynamicSystemInstruction}\n${context.finalPrompt}`;

  assert.ok(combined.indexOf('System Prompt') < combined.indexOf('Dynamic Prompt'));
  assert.ok(combined.indexOf('Dynamic Prompt') < combined.indexOf('[Long-Term Memory]'));
  assert.ok(
    combined.indexOf('[Long-Term Memory]') <
      combined.indexOf('Ringkasan percakapan sebelumnya: Keputusan sebelumnya'),
  );
  assert.ok(combined.indexOf('Ringkasan percakapan sebelumnya') < combined.indexOf('Pesan lama user.'));
  assert.ok(combined.indexOf('Pesan lama user.') < combined.indexOf('Pesan saat ini.'));
});

test('missing summary is skipped while preserving order', () => {
  const context = buildFinalContext({
    systemPrompt: 'System',
    dynamicPrompt: 'Dynamic',
    longTermMemory: '[Memory]',
    conversationSummary: null,
    recentMessages: [],
    currentUserMessage: 'Current',
  });

  assert.match(context.dynamicSystemInstruction, /System/);
  assert.match(context.dynamicSystemInstruction, /Dynamic/);
  assert.match(context.dynamicSystemInstruction, /\[Memory\]/);
  assert.doesNotMatch(context.dynamicSystemInstruction, /Ringkasan percakapan sebelumnya/);
  assert.equal(context.finalPrompt, 'Current');
});

test('missing long-term memory is skipped while preserving order', () => {
  const context = buildFinalContext({
    systemPrompt: 'System',
    dynamicPrompt: 'Dynamic',
    longTermMemory: null,
    conversationSummary: 'Ringkas.',
    recentMessages: [],
    currentUserMessage: 'Current',
  });

  assert.ok(context.dynamicSystemInstruction.indexOf('Dynamic') < context.dynamicSystemInstruction.indexOf('Ringkas.'));
  assert.equal(context.finalPrompt, 'Current');
});

test('empty summary is treated as missing', () => {
  assert.equal(injectSummarySection('System', '   '), 'System');
  assert.equal(formatSummaryForPrompt('   '), null);
});

test('summary is truncated from the start when too long', () => {
  const summary = `${'a'.repeat(10)}RECENT`;
  const formatted = formatSummaryForPrompt(summary, { maxLength: 6 });

  assert.equal(formatted, 'Ringkasan percakapan sebelumnya: RECENT');
});

test('context builder never throws and falls back without summary', () => {
  const context = buildFinalContext({
    systemPrompt: 'System',
    dynamicPrompt: 'Dynamic',
    longTermMemory: '[Memory]',
    conversationSummary: {
      trim: () => {
        throw new Error('bad summary');
      },
    } as unknown as string,
    recentMessages: [],
    currentUserMessage: 'Current',
  });

  assert.equal(context.dynamicSystemInstruction, 'System\nDynamic\n[Memory]');
  assert.equal(context.finalPrompt, 'Current');
});

test('chat request shape remains compatible with ProviderManager input', () => {
  const context = buildFinalContext({
    systemPrompt: 'System',
    dynamicPrompt: '',
    longTermMemory: null,
    conversationSummary: null,
    recentMessages: [],
    currentUserMessage: 'Current',
  });

  assert.deepEqual(Object.keys(context).sort(), ['dynamicSystemInstruction', 'finalPrompt']);
  assert.equal(typeof context.dynamicSystemInstruction, 'string');
  assert.equal(typeof context.finalPrompt, 'string');
});

test('estimateContextTokens returns a rough non-blocking estimate', () => {
  assert.equal(estimateContextTokens('12345678'), 2);
  assert.equal(estimateContextTokens(''), 0);
});
