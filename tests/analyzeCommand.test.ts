/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

import groq from '../src/ai/groq';
import { boundAnalysisSource, describeAnalyzeEngine, execute } from '../src/commands/analyze';
import { circuitBreaker } from '../src/services/ai/circuitBreaker';
import { providerManager } from '../src/services/ai/providerManager';
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

test('deep analyze skips direct Groq call when Groq provider circuit is open', async () => {
  circuitBreaker.reset();
  circuitBreaker.recordFailure(AIProviderName.GROQ, { status: 429 });
  circuitBreaker.recordFailure(AIProviderName.GROQ, { status: 429 });
  circuitBreaker.recordFailure(AIProviderName.GROQ, { status: 429 });

  const originalAxiosGet = axios.get;
  const originalGroqCreate = groq.chat.completions.create;
  const originalProviderGenerate = providerManager.generate.bind(providerManager);
  let directGroqCalls = 0;
  let providerManagerCalls = 0;

  (axios as unknown as { get: (url: string, options: unknown) => Promise<{ data: string }> }).get = async () => ({
    data: 'konten untuk dianalisis',
  });
  (groq.chat.completions as unknown as { create: () => Promise<unknown> }).create = async () => {
    directGroqCalls += 1;
    throw new Error('direct groq should be skipped');
  };
  providerManager.generate = async () => {
    providerManagerCalls += 1;
    return { replyText: 'fallback analysis', providerUsed: AIProviderName.OPENROUTER };
  };

  const editReplies: unknown[] = [];
  const interaction = {
    user: { id: 'analyze-user' },
    guildId: 'guild-1',
    channelId: 'channel-1',
    id: 'interaction-1',
    deferred: true,
    replied: false,
    options: {
      getAttachment: () => null,
      getString: (name: string) => {
        if (name === 'url') return 'https://example.com/doc.txt';
        if (name === 'perintah') return 'Analisis ini';
        if (name === 'mode') return 'mendalam';
        return null;
      },
    },
    deferReply: async () => undefined,
    editReply: async (payload: unknown) => {
      editReplies.push(payload);
      return undefined;
    },
    followUp: async () => undefined,
  };
  const db = {
    prepare: () => ({
      get: () => undefined,
    }),
  };

  try {
    await execute(interaction as never, { db } as never);

    assert.equal(directGroqCalls, 0);
    assert.equal(providerManagerCalls, 1);
    assert.match(String((editReplies[0] as { content?: string })?.content ?? editReplies[0]), /fallback analysis/);
  } finally {
    axios.get = originalAxiosGet;
    groq.chat.completions.create = originalGroqCreate;
    providerManager.generate = originalProviderGenerate;
    circuitBreaker.reset();
  }
});
