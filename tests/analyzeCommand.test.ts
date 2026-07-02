/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

import groq from '../src/ai/groq';
import { boundAnalysisSource, describeAnalyzeEngine, execute } from '../src/commands/analyze';
import { circuitBreaker } from '../src/services/ai/circuitBreaker';
import { providerManager } from '../src/services/ai/providerManager';
import { AIProviderName } from '../src/services/ai/types';
import type { ChatRequest } from '../src/services/ai/types';
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

test('standard analyze prompt includes Discord formatting guidance', async () => {
  const originalAxiosGet = axios.get;
  const originalProviderGenerate = providerManager.generate.bind(providerManager);
  let capturedSystemPrompt = '';

  (axios as unknown as { get: (url: string, options: unknown) => Promise<{ data: string }> }).get = async () => ({
    data: 'konten untuk dianalisis',
  });
  providerManager.generate = async (request: ChatRequest) => {
    capturedSystemPrompt = request.dynamicSystemInstruction;
    return { replyText: 'standard analysis', providerUsed: AIProviderName.GEMINI };
  };

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
        if (name === 'mode') return 'standar';
        return null;
      },
    },
    deferReply: async () => undefined,
    editReply: async () => undefined,
    followUp: async () => undefined,
  };
  const db = {
    prepare: () => ({
      get: () => undefined,
    }),
  };

  try {
    await execute(interaction as never, { db } as never);

    assert.match(capturedSystemPrompt, /Discord/i);
    assert.match(capturedSystemPrompt, /markdown table syntax/i);
    assert.match(capturedSystemPrompt, /labeled list/i);
  } finally {
    axios.get = originalAxiosGet;
    providerManager.generate = originalProviderGenerate;
  }
});

test('deep primary analyze prompt includes Discord formatting guidance', async () => {
  circuitBreaker.reset();
  const originalAxiosGet = axios.get;
  const originalGroqCreate = groq.chat.completions.create;
  let capturedSystemPrompt = '';

  (axios as unknown as { get: (url: string, options: unknown) => Promise<{ data: string }> }).get = async () => ({
    data: 'konten untuk dianalisis',
  });
  (groq.chat.completions as unknown as {
    create: (request: { messages: Array<{ role: string; content: string }> }) => Promise<{
      choices: Array<{ message: { content: string } }>;
    }>;
  }).create = async (request) => {
    capturedSystemPrompt = request.messages.find((message) => message.role === 'system')?.content ?? '';
    return { choices: [{ message: { content: 'deep analysis' } }] };
  };

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
    editReply: async () => undefined,
    followUp: async () => undefined,
  };
  const db = {
    prepare: () => ({
      get: () => undefined,
    }),
  };

  try {
    await execute(interaction as never, { db } as never);

    assert.match(capturedSystemPrompt, /Discord/i);
    assert.match(capturedSystemPrompt, /markdown table syntax/i);
    assert.match(capturedSystemPrompt, /labeled list/i);
  } finally {
    axios.get = originalAxiosGet;
    groq.chat.completions.create = originalGroqCreate;
    circuitBreaker.reset();
  }
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
  let capturedSystemPrompt = '';

  (axios as unknown as { get: (url: string, options: unknown) => Promise<{ data: string }> }).get = async () => ({
    data: 'konten untuk dianalisis',
  });
  (groq.chat.completions as unknown as { create: () => Promise<unknown> }).create = async () => {
    directGroqCalls += 1;
    throw new Error('direct groq should be skipped');
  };
  providerManager.generate = async (request: ChatRequest) => {
    providerManagerCalls += 1;
    capturedSystemPrompt = request.dynamicSystemInstruction;
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
    assert.match(capturedSystemPrompt, /Discord/i);
    assert.match(capturedSystemPrompt, /markdown table syntax/i);
    assert.match(capturedSystemPrompt, /labeled list/i);
    assert.match(String((editReplies[0] as { content?: string })?.content ?? editReplies[0]), /fallback analysis/);
  } finally {
    axios.get = originalAxiosGet;
    groq.chat.completions.create = originalGroqCreate;
    providerManager.generate = originalProviderGenerate;
    circuitBreaker.reset();
  }
});
