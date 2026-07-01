import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markCooldown,
  recordHealthFailure,
  recordHealthSuccess,
  resetHealth,
} from '../src/services/ai/healthCache';
import {
  formatAIHealthDashboard,
  formatCooldown,
  formatHealthResetResult,
  formatRelativeTime,
  truncateError,
} from '../src/services/ai/healthFormatter';

const NOW = 1_800_000;

function transientError(message: string): Error {
  return new Error(message);
}

test('formats healthy provider state with score and latency', () => {
  resetHealth();
  recordHealthSuccess('gemini', 720);

  const output = formatAIHealthDashboard({
    now: NOW,
    providers: ['gemini'],
    openRouterModels: [],
  });

  assert.match(output, /AI Provider Health/);
  assert.match(output, /Gemini/);
  assert.match(output, /Status: Healthy/);
  assert.match(output, /Score: 163/);
  assert.match(output, /Success: 1/);
  assert.match(output, /Failure: 0/);
  assert.match(output, /Success Rate: 100%/);
  assert.match(output, /Average Latency: 720ms/);
  assert.match(output, /Last Latency: 720ms/);
  assert.match(output, /Last Success: Just now/);
});

test('formats cooldown durations', () => {
  assert.equal(formatCooldown(null, NOW), '-');
  assert.equal(formatCooldown(NOW - 1, NOW), '-');
  assert.equal(formatCooldown(NOW + 52_000, NOW), '52s');
  assert.equal(formatCooldown(NOW + 195_000, NOW), '3m 15s');
  assert.equal(formatCooldown(NOW + 4_320_000, NOW), '1h 12m');
});

test('formats health reset results for all and unknown targets', () => {
  assert.equal(formatHealthResetResult({ target: null, existed: true }), 'AI health state reset for all targets.');
  assert.equal(
    formatHealthResetResult({ target: 'openrouter:model-a', existed: false }),
    'AI health state reset for `openrouter:model-a`. No previous runtime state was found.',
  );
});

test('formats relative timestamps', () => {
  assert.equal(formatRelativeTime(null, NOW), 'Never');
  assert.equal(formatRelativeTime(NOW - 10_000, NOW), 'Just now');
  assert.equal(formatRelativeTime(NOW - 120_000, NOW), '2 minutes ago');
  assert.equal(formatRelativeTime(NOW - 900_000, NOW), '15 minutes ago');
});

test('formats OpenRouter nested model health', () => {
  resetHealth();
  recordHealthSuccess('openrouter', 600);
  recordHealthSuccess('openrouter:qwen/qwen3-32b:free', 720);
  markCooldown('openrouter:deepseek/deepseek-chat:free', NOW + 120_000, transientError('rate limit'));

  const output = formatAIHealthDashboard({
    now: NOW,
    providers: ['openrouter'],
    openRouterModels: ['qwen/qwen3-32b:free', 'deepseek/deepseek-chat:free'],
  });

  assert.match(output, /OpenRouter/);
  assert.match(output, /├── qwen\/qwen3-32b:free/);
  assert.match(output, /│   Status: Healthy/);
  assert.match(output, /│   Score: 163/);
  assert.match(output, /│   Latency: 720ms/);
  assert.match(output, /└── deepseek\/deepseek-chat:free/);
  assert.match(output, /    Status: Cooldown/);
  assert.match(output, /    Remaining: 2m/);
});

test('formats empty provider list', () => {
  resetHealth();

  const output = formatAIHealthDashboard({
    now: NOW,
    providers: [],
    openRouterModels: [],
  });

  assert.match(output, /No AI providers configured\./);
});

test('formats unknown provider state', () => {
  resetHealth();

  const output = formatAIHealthDashboard({
    now: NOW,
    providers: ['groq'],
    openRouterModels: [],
  });

  assert.match(output, /Groq/);
  assert.match(output, /Status: Unknown/);
  assert.match(output, /Score: 100/);
  assert.match(output, /Last Success: Never/);
  assert.match(output, /Last Failure: Never/);
});

test('truncates long errors', () => {
  resetHealth();
  recordHealthFailure(
    'gemini',
    transientError('x'.repeat(120)),
    true,
  );

  const output = formatAIHealthDashboard({
    now: NOW,
    providers: ['gemini'],
    openRouterModels: [],
  });

  assert.match(output, /Last Error: x{77}\.\.\./);
});

test('exports long error truncation helper', () => {
  assert.equal(truncateError('x'.repeat(120)), `${'x'.repeat(77)}...`);
  assert.equal(truncateError(null), '-');
});
