import { DEBUG_AI, OPENROUTER_MODELS } from '../../config/env';
import { circuitBreaker } from './circuitBreaker';
import { getHealth } from './healthCache';
import type { ProviderHealthState, ProviderHealthStatus } from './healthCache';
import { scoreHealth } from './providerRanking';

const PROVIDERS = ['gemini', 'groq', 'openrouter'] as const;
const MAX_ERROR_LENGTH = 80;
const DEBUG = DEBUG_AI;

interface HealthDashboardOptions {
  now?: number;
  providers?: string[];
  openRouterModels?: string[];
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function displayName(target: string): string {
  if (target === 'openrouter') return 'OpenRouter';
  return titleCase(target);
}

function formatStatus(status: ProviderHealthStatus): string {
  return titleCase(status);
}

function successRate(health: ProviderHealthState): string {
  const attempts = health.successCount + health.failureCount;
  if (attempts === 0) return '0%';
  return `${Math.round((health.successCount / attempts) * 100)}%`;
}

function formatLatency(value: number | null): string {
  return value === null ? '-' : `${value}ms`;
}

export function truncateError(value: string | null): string {
  if (value === null || value.length === 0) return '-';
  if (value.length <= MAX_ERROR_LENGTH) return value;
  return `${value.slice(0, MAX_ERROR_LENGTH - 3)}...`;
}

function runtimeHealth(target: string): ProviderHealthState {
  const health = getHealth(target);
  const circuit = circuitBreaker.getState(target);
  if (!circuit.isOpen) return health;

  return {
    ...health,
    status: 'cooldown',
    cooldownUntil: circuit.openedUntil ?? health.cooldownUntil,
    lastError: health.lastError ?? circuit.lastError ?? null,
  };
}

function formatProviderDetails(target: string, now: number): string[] {
  const health = runtimeHealth(target);
  return [
    `${displayName(target)}`,
    `Status: ${formatStatus(health.status)}`,
    `Current Score: ${Math.round(scoreHealth(target))}`,
    `Success: ${health.successCount}`,
    `Failure: ${health.failureCount}`,
    `Success Rate: ${successRate(health)}`,
    `Average Latency: ${formatLatency(health.averageLatencyMs)}`,
    `Last Latency: ${formatLatency(health.lastLatencyMs)}`,
    `Consecutive Failures: ${health.consecutiveFailures}`,
    `Cooldown Remaining: ${formatCooldown(health.cooldownUntil, now)}`,
    `Last Success: ${formatRelativeTime(health.lastSuccessAt, now)}`,
    `Last Failure: ${formatRelativeTime(health.lastFailureAt, now)}`,
    `Last Error: ${truncateError(health.lastError)}`,
  ];
}

function formatModelDetails(model: string, index: number, total: number, now: number): string[] {
  const target = `openrouter:${model}`;
  const health = runtimeHealth(target);
  const branch = index === total - 1 ? '└──' : '├──';
  const detailPrefix = index === total - 1 ? '    ' : '│   ';

  return [
    `${branch} ${model}`,
    `${detailPrefix}Status: ${formatStatus(health.status)}`,
    `${detailPrefix}Score: ${Math.round(scoreHealth(target))}`,
    `${detailPrefix}Latency: ${formatLatency(health.lastLatencyMs)}`,
    `${detailPrefix}Success: ${health.successCount}`,
    `${detailPrefix}Failure: ${health.failureCount}`,
    `${detailPrefix}Consecutive Failures: ${health.consecutiveFailures}`,
    `${detailPrefix}Remaining: ${formatCooldown(health.cooldownUntil, now)}`,
    `${detailPrefix}Last Success: ${formatRelativeTime(health.lastSuccessAt, now)}`,
    `${detailPrefix}Last Failure: ${formatRelativeTime(health.lastFailureAt, now)}`,
    `${detailPrefix}Last Error: ${truncateError(health.lastError)}`,
  ];
}

/** Formats an epoch timestamp as a short relative time for Discord output. */
export function formatRelativeTime(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return 'Never';

  const elapsedMs = Math.max(0, now - timestamp);
  if (elapsedMs < 60_000) return 'Just now';

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Formats a cooldown expiry timestamp as remaining time for Discord output. */
export function formatCooldown(cooldownUntil: number | null, now = Date.now()): string {
  if (cooldownUntil === null || cooldownUntil <= now) return '-';

  const remainingSeconds = Math.ceil((cooldownUntil - now) / 1_000);
  if (remainingSeconds < 60) return `${remainingSeconds}s`;

  const remainingMinutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  if (remainingMinutes < 60) {
    return seconds === 0 ? `${remainingMinutes}m` : `${remainingMinutes}m ${seconds}s`;
  }

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Builds the complete AI provider health dashboard for the /health command. */
export function formatHealthDashboard(options: HealthDashboardOptions = {}): string {
  const now = options.now ?? Date.now();
  const providers = options.providers ?? [...PROVIDERS];
  const openRouterModels = options.openRouterModels ?? OPENROUTER_MODELS;

  const lines = ['**AI Provider Health**', '====================', ''];

  if (providers.length === 0) {
    lines.push('No AI providers configured.');
  }

  for (const provider of providers) {
    lines.push(...formatProviderDetails(provider, now));

    if (provider === 'openrouter' && openRouterModels.length > 0) {
      lines.push('');
      openRouterModels.forEach((model, index) => {
        lines.push(...formatModelDetails(model, index, openRouterModels.length, now));
        if (index < openRouterModels.length - 1) lines.push('│');
      });
    }

    lines.push('');
  }

  if (DEBUG) {
    console.log('[Health Dashboard]');
    console.log('Generated dashboard');
    console.log(`Provider count: ${providers.length}`);
    console.log(`OpenRouter models: ${openRouterModels.length}`);
  }

  return lines.join('\n').trimEnd();
}

export const formatAIHealthDashboard = formatHealthDashboard;

export function formatHealthResetResult(options: {
  target: string | null;
  existed: boolean;
}): string {
  if (options.target === null) {
    return 'AI health state reset for all targets.';
  }

  const suffix = options.existed ? '' : ' No previous runtime state was found.';
  return `AI health state reset for \`${options.target}\`.${suffix}`;
}
