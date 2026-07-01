import assert from 'node:assert/strict';
import test from 'node:test';

import { CircuitBreaker } from '../src/services/ai/circuitBreaker';
import { AIProviderName, TaskType } from '../src/services/ai/types';
import type { AIProvider, ChatRequest } from '../src/services/ai/types';
import {
  getAllHealth,
  getHealth,
  markCooldown,
  recordHealthFailure,
  recordHealthSuccess,
  resetHealth,
} from '../src/services/ai/healthCache';

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

test('unknown target returns an unknown default health state', () => {
  resetHealth();

  assert.deepEqual(getHealth('gemini'), {
    target: 'gemini',
    status: 'unknown',
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    averageLatencyMs: 0,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    cooldownUntil: null,
  });
});

test('success records latency and resets failures back to healthy', () => {
  resetHealth();

  recordHealthFailure('groq', transientError(503), true);
  recordHealthSuccess('groq', 100);
  recordHealthSuccess('groq', 200);

  const health = getHealth('groq');
  assert.equal(health.status, 'healthy');
  assert.equal(health.successCount, 2);
  assert.equal(health.failureCount, 1);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.averageLatencyMs, 150);
  assert.equal(health.lastLatencyMs, 200);
  assert.equal(health.lastError, null);
  assert.equal(typeof health.lastSuccessAt, 'number');
});

test('transient failure marks target degraded and records error', () => {
  resetHealth();

  recordHealthFailure('openrouter', transientError(429), true);

  const health = getHealth('openrouter');
  assert.equal(health.status, 'degraded');
  assert.equal(health.failureCount, 1);
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastError, 'status 429');
  assert.equal(typeof health.lastFailureAt, 'number');
});

test('non-transient failure records counters without degrading health', () => {
  resetHealth();

  recordHealthFailure('gemini', Object.assign(new Error('bad request'), { status: 400 }), false);

  const health = getHealth('gemini');
  assert.equal(health.status, 'unknown');
  assert.equal(health.failureCount, 1);
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastError, 'bad request');
});

test('cooldown marks target cooldown and is listed by getAllHealth', () => {
  resetHealth();
  const cooldownUntil = Date.now() + 300_000;

  markCooldown('openrouter:model-a', cooldownUntil, transientError(429));

  const health = getHealth('openrouter:model-a');
  assert.equal(health.status, 'cooldown');
  assert.equal(health.cooldownUntil, cooldownUntil);
  assert.equal(health.lastError, 'status 429');
  assert.deepEqual(getAllHealth().map((state) => state.target), ['openrouter:model-a']);
});

test('ProviderManager records provider health and cooldown state', async () => {
  resetHealth();
  const { ProviderManager } = await import('../src/services/ai/providerManager');
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });

  const gemini: AIProvider = {
    name: AIProviderName.GEMINI,
    supportsVision: true,
    supportsReasoning: true,
    supportsCoding: true,
    generate: async () => {
      throw transientError(429);
    },
  };
  const groq: AIProvider = {
    name: AIProviderName.GROQ,
    supportsVision: false,
    supportsReasoning: false,
    supportsCoding: true,
    generate: async () => ({ replyText: 'ok', providerUsed: AIProviderName.GROQ }),
  };

  const manager = new ProviderManager({ circuitBreaker: breaker });
  manager.registerProvider(gemini);
  manager.registerProvider(groq);

  const response = await manager.generate(request());

  assert.equal(response.providerUsed, AIProviderName.GROQ);
  assert.equal(getHealth(AIProviderName.GEMINI).status, 'cooldown');
  assert.equal(getHealth(AIProviderName.GEMINI).failureCount, 1);
  assert.equal(typeof getHealth(AIProviderName.GEMINI).cooldownUntil, 'number');
  assert.equal(getHealth(AIProviderName.GROQ).status, 'healthy');
  assert.equal(getHealth(AIProviderName.GROQ).successCount, 1);
});

test('OpenRouterProvider records per-model health and cooldown state', async () => {
  resetHealth();
  const { OpenRouterProvider } = await import('../src/services/ai/providers/openrouterProvider');
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });
  const triedModels: string[] = [];

  const provider = new OpenRouterProvider({
    apiKey: 'test-key',
    models: ['model-a', 'model-b'],
    circuitBreaker: breaker,
    client: {
      chat: {
        completions: {
          create: async ({ model }: { model: string }) => {
            triedModels.push(model);
            if (model === 'model-a') throw transientError(503);
            return { choices: [{ message: { content: 'ok' } }] };
          },
        },
      },
    },
  });

  const response = await provider.generate(request(TaskType.CODING));

  assert.equal(response.replyText, 'ok');
  assert.deepEqual(triedModels, ['model-a', 'model-b']);
  assert.equal(getHealth('openrouter:model-a').status, 'cooldown');
  assert.equal(getHealth('openrouter:model-a').failureCount, 1);
  assert.equal(typeof getHealth('openrouter:model-a').cooldownUntil, 'number');
  assert.equal(getHealth('openrouter:model-b').status, 'healthy');
  assert.equal(getHealth('openrouter:model-b').successCount, 1);
});
