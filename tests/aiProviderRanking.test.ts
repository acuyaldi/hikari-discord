import assert from 'node:assert/strict';
import test from 'node:test';

import { CircuitBreaker } from '../src/services/ai/circuitBreaker';
import {
  markCooldown,
  recordHealthFailure,
  recordHealthSuccess,
  resetHealth,
} from '../src/services/ai/healthCache';
import { AIProviderName, TaskType } from '../src/services/ai/types';
import type { AIProvider, ChatRequest } from '../src/services/ai/types';
import { rankTargets, scoreHealth } from '../src/services/ai/providerRanking';

function request(taskType = TaskType.GENERAL): ChatRequest {
  return {
    userId: 'user-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    promptText: 'hello',
    identityPrefix: '',
    finalPrompt: 'hello',
    dynamicSystemInstruction: 'system',
    hasImage: false,
    taskType,
  };
}

function transientError(status = 429): Error & { status: number } {
  const err = new Error(`status ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

test('healthy provider ranks above degraded provider', () => {
  resetHealth();
  recordHealthSuccess('gemini', 100);
  recordHealthFailure('groq', transientError(503), true);

  assert.deepEqual(rankTargets(['groq', 'gemini']), ['gemini', 'groq']);
});

test('lower latency ranks above higher latency', () => {
  resetHealth();
  recordHealthSuccess('slow', 1_000);
  recordHealthSuccess('fast', 100);

  assert.deepEqual(rankTargets(['slow', 'fast']), ['fast', 'slow']);
});

test('repeated failures lower health score', () => {
  resetHealth();
  recordHealthSuccess('steady', 100);
  recordHealthSuccess('flaky', 100);
  recordHealthFailure('flaky', transientError(503), true);
  recordHealthFailure('flaky', transientError(503), true);

  assert.ok(scoreHealth('steady') > scoreHealth('flaky'));
  assert.deepEqual(rankTargets(['flaky', 'steady']), ['steady', 'flaky']);
});

test('cooldown target ranks last', () => {
  resetHealth();
  recordHealthSuccess('healthy', 100);
  markCooldown('cooling', Date.now() + 300_000, transientError(429));
  recordHealthFailure('degraded', transientError(503), true);

  assert.deepEqual(rankTargets(['cooling', 'degraded', 'healthy']), [
    'healthy',
    'degraded',
    'cooling',
  ]);
});

test('unknown provider stays usable', () => {
  resetHealth();
  recordHealthFailure('degraded', transientError(503), true);

  assert.ok(scoreHealth('unknown-provider') > scoreHealth('degraded'));
  assert.deepEqual(rankTargets(['degraded', 'unknown-provider']), [
    'unknown-provider',
    'degraded',
  ]);
});

test('equal score preserves original order and does not mutate input', () => {
  resetHealth();
  const targets = ['gemini', 'groq', 'openrouter'];

  const ranked = rankTargets(targets);

  assert.deepEqual(ranked, ['gemini', 'groq', 'openrouter']);
  assert.notEqual(ranked, targets);
  assert.deepEqual(targets, ['gemini', 'groq', 'openrouter']);
});

test('ProviderManager ranks available providers before trying them', async () => {
  resetHealth();
  recordHealthFailure(AIProviderName.GEMINI, transientError(503), true);
  recordHealthSuccess(AIProviderName.GROQ, 50);

  const { ProviderManager } = await import('../src/services/ai/providerManager');
  const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 300_000 });
  const calls: AIProviderName[] = [];

  const gemini: AIProvider = {
    name: AIProviderName.GEMINI,
    supportsVision: true,
    supportsReasoning: true,
    supportsCoding: true,
    generate: async () => {
      calls.push(AIProviderName.GEMINI);
      return { replyText: 'gemini', providerUsed: AIProviderName.GEMINI };
    },
  };
  const groq: AIProvider = {
    name: AIProviderName.GROQ,
    supportsVision: false,
    supportsReasoning: false,
    supportsCoding: true,
    generate: async () => {
      calls.push(AIProviderName.GROQ);
      return { replyText: 'groq', providerUsed: AIProviderName.GROQ };
    },
  };

  const manager = new ProviderManager({ circuitBreaker: breaker });
  manager.registerProvider(gemini);
  manager.registerProvider(groq);

  const response = await manager.generate(request(TaskType.CODING));

  assert.equal(response.providerUsed, AIProviderName.GROQ);
  assert.deepEqual(calls, [AIProviderName.GROQ]);
});

test('OpenRouterProvider ranks models before trying them', async () => {
  resetHealth();
  recordHealthFailure('openrouter:model-a', transientError(503), true);
  recordHealthSuccess('openrouter:model-b', 50);

  const { OpenRouterProvider } = await import('../src/services/ai/providers/openrouterProvider');
  const triedModels: string[] = [];

  const provider = new OpenRouterProvider({
    apiKey: 'test-key',
    models: ['model-a', 'model-b'],
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 300_000 }),
    client: {
      chat: {
        completions: {
          create: async ({ model }: { model: string }) => {
            triedModels.push(model);
            return { choices: [{ message: { content: 'ok' } }] };
          },
        },
      },
    },
  });

  const response = await provider.generate(request(TaskType.CODING));

  assert.equal(response.replyText, 'ok');
  assert.deepEqual(triedModels, ['model-b']);
});
