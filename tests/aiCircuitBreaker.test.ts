import assert from 'node:assert/strict';
import test from 'node:test';

import { AIProviderName, TaskType } from '../src/services/ai/types';
import type { AIProvider, ChatRequest } from '../src/services/ai/types';
import { CircuitBreaker, isTransientAIError } from '../src/services/ai/circuitBreaker';

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

test('transient failures increment failure count and open circuit after threshold', () => {
  const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 300_000 });
  const target = 'gemini';

  breaker.recordFailure(target, transientError(429));
  assert.equal(breaker.getState(target).failureCount, 1);
  assert.equal(breaker.isAvailable(target), true);

  breaker.recordFailure(target, transientError(503));
  const state = breaker.getState(target);
  assert.equal(state.failureCount, 2);
  assert.equal(state.isOpen, true);
  assert.equal(breaker.isAvailable(target), false);
});

test('success resets failure count and closes circuit', () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });
  const target = 'openrouter:qwen/qwen3-32b:free';

  breaker.recordFailure(target, transientError(429));
  assert.equal(breaker.isAvailable(target), false);

  breaker.recordSuccess(target);
  const state = breaker.getState(target);
  assert.equal(state.failureCount, 0);
  assert.equal(state.isOpen, false);
  assert.equal(state.lastError, undefined);
  assert.equal(breaker.isAvailable(target), true);
});

test('non-transient failures are tracked without opening circuit', () => {
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });

  breaker.recordFailure('groq', Object.assign(new Error('bad request'), { status: 400 }));

  const state = breaker.getState('groq');
  assert.equal(state.failureCount, 0);
  assert.equal(state.lastError, 'bad request');
  assert.equal(state.isOpen, false);
  assert.equal(breaker.isAvailable('groq'), true);
});

test('timeout and 5xx errors are treated as transient', () => {
  assert.equal(isTransientAIError(Object.assign(new Error('rate limit'), { status: 429 })), true);
  assert.equal(isTransientAIError(Object.assign(new Error('server'), { status: 500 })), true);
  assert.equal(isTransientAIError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), true);
  assert.equal(isTransientAIError(new Error('request timeout after 30000ms')), true);
  assert.equal(isTransientAIError(Object.assign(new Error('bad request'), { status: 400 })), false);
});

test('ProviderManager skips providers whose circuit is cooling down', async () => {
  const { ProviderManager } = await import('../src/services/ai/providerManager');
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });
  const calls: AIProviderName[] = [];

  const gemini: AIProvider = {
    name: AIProviderName.GEMINI,
    supportsVision: true,
    supportsReasoning: true,
    supportsCoding: true,
    generate: async () => {
      calls.push(AIProviderName.GEMINI);
      throw transientError(429);
    },
  };
  const groq: AIProvider = {
    name: AIProviderName.GROQ,
    supportsVision: false,
    supportsReasoning: false,
    supportsCoding: true,
    generate: async () => {
      calls.push(AIProviderName.GROQ);
      return { replyText: 'ok', providerUsed: AIProviderName.GROQ };
    },
  };

  breaker.recordFailure(AIProviderName.GEMINI, transientError(429));
  const manager = new ProviderManager({ circuitBreaker: breaker });
  manager.registerProvider(gemini);
  manager.registerProvider(groq);

  const response = await manager.generate(request());

  assert.equal(response.providerUsed, AIProviderName.GROQ);
  assert.deepEqual(calls, [AIProviderName.GROQ]);
});

test('ProviderManager throws a clear error when every provider is cooling down', async () => {
  const { ProviderManager } = await import('../src/services/ai/providerManager');
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });
  const manager = new ProviderManager({ circuitBreaker: breaker });

  for (const name of [
    AIProviderName.GEMINI,
    AIProviderName.GROQ,
    AIProviderName.OPENROUTER,
    AIProviderName.HUGGINGFACE,
  ]) {
    breaker.recordFailure(name, transientError(429));
    manager.registerProvider({
      name,
      supportsVision: name === AIProviderName.GEMINI,
      supportsReasoning: name === AIProviderName.GEMINI,
      supportsCoding: true,
      generate: async () => ({ replyText: 'unexpected', providerUsed: name }),
    });
  }

  await assert.rejects(
    () => manager.generate(request()),
    /All providers are temporarily unavailable/i,
  );
});

test('OpenRouterProvider skips models whose circuit is cooling down', async () => {
  const { OpenRouterProvider } = await import('../src/services/ai/providers/openrouterProvider');
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });
  breaker.recordFailure('openrouter:model-a', transientError(429));

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

test('OpenRouterProvider handles all cooled-down models with a clear error', async () => {
  const { OpenRouterProvider } = await import('../src/services/ai/providers/openrouterProvider');
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });
  breaker.recordFailure('openrouter:model-a', transientError(429));
  breaker.recordFailure('openrouter:model-b', transientError(429));

  const provider = new OpenRouterProvider({
    apiKey: 'test-key',
    models: ['model-a', 'model-b'],
    circuitBreaker: breaker,
    client: {
      chat: {
        completions: {
          create: async () => {
            throw new Error('should not be called');
          },
        },
      },
    },
  });

  await assert.rejects(
    () => provider.generate(request(TaskType.CODING)),
    /OpenRouter: all models are temporarily unavailable/i,
  );
});
