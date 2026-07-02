import assert from 'node:assert/strict';
import test from 'node:test';

import { CircuitBreaker } from '../src/services/ai/circuitBreaker';
import {
  formatDebugRouting,
  getDebugRoutingSnapshot,
} from '../src/services/ai/aiDebugFormatter';
import { recordHealthFailure, recordHealthSuccess, resetHealth } from '../src/services/ai/healthCache';
import { AIProviderName, TaskType } from '../src/services/ai/types';

function transientError(status = 429): Error & { status: number } {
  const err = new Error(`status ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

test('formats debug routing output without calling providers', () => {
  resetHealth();
  recordHealthSuccess(AIProviderName.GROQ, 50);
  recordHealthFailure(AIProviderName.GEMINI, transientError(503), true);

  const snapshot = getDebugRoutingSnapshot('please debug this code error', {
    providerOrder: [AIProviderName.GEMINI, AIProviderName.GROQ, AIProviderName.OPENROUTER],
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 300_000 }),
  });
  const output = formatDebugRouting(snapshot);

  assert.equal(snapshot.taskType, TaskType.CODING);
  assert.deepEqual(snapshot.configuredProviderOrder, [
    AIProviderName.GEMINI,
    AIProviderName.GROQ,
    AIProviderName.OPENROUTER,
  ]);
  assert.equal(snapshot.selectedProvider, AIProviderName.GROQ);
  assert.match(output, /Task Type: CODING/);
  assert.match(output, /Configured Provider Order: gemini, groq, openrouter/);
  assert.match(output, /Ranked Provider Order: groq, openrouter, gemini/);
  assert.match(output, /Selected First Provider: groq/);
});

test('debug routing output shows cooldown providers as skipped', () => {
  resetHealth();
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });
  breaker.recordFailure(AIProviderName.GEMINI, transientError(429));

  const snapshot = getDebugRoutingSnapshot('hello', {
    providerOrder: [AIProviderName.GEMINI, AIProviderName.GROQ],
    circuitBreaker: breaker,
  });
  const output = formatDebugRouting(snapshot);

  assert.deepEqual(snapshot.skippedProviders, [AIProviderName.GEMINI]);
  assert.equal(snapshot.selectedProvider, AIProviderName.GROQ);
  assert.match(output, /Skipped Providers: gemini \(cooldown\)/);
  assert.match(output, /Selected First Provider: groq/);
});
