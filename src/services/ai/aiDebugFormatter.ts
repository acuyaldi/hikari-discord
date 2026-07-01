import { AI_PROVIDER_ORDER } from '../../config/env';
import { classifyTask } from '../../ai/router';
import { circuitBreaker as defaultCircuitBreaker, type CircuitBreaker } from './circuitBreaker';
import { formatRelativeTime } from './healthFormatter';
import type { ProviderOverrideMode, ProviderOverrideScope } from './providerOverride';
import type { ProviderMetricsSnapshot, MetricSnapshot } from './providerMetrics';
import { rankTargets } from './providerRanking';
import { AIProviderName, TaskType } from './types';

interface FormatterOptions {
  now?: number;
}

interface DebugRoutingOptions {
  providerOrder?: AIProviderName[];
  circuitBreaker?: CircuitBreaker;
}

export interface DebugRoutingSnapshot {
  prompt: string;
  taskType: TaskType;
  configuredProviderOrder: AIProviderName[];
  rankedProviderOrder: AIProviderName[];
  skippedProviders: AIProviderName[];
  selectedProvider: AIProviderName | null;
}

const VALID_PROVIDER_NAMES = new Set<string>(Object.values(AIProviderName));

function parseProviderOrder(raw: string): AIProviderName[] {
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => VALID_PROVIDER_NAMES.has(value)) as AIProviderName[];
}

function defaultProviderOrder(): AIProviderName[] {
  const configured = parseProviderOrder(AI_PROVIDER_ORDER);
  return configured.length > 0 ? configured : [AIProviderName.GEMINI];
}

function capabilityRank(name: AIProviderName, taskType: TaskType): boolean {
  switch (taskType) {
    case TaskType.CODING:
      return true;
    case TaskType.VISION:
      return name === AIProviderName.GEMINI;
    case TaskType.REASONING:
      return name === AIProviderName.GEMINI;
    case TaskType.SEARCH:
      return name === AIProviderName.GEMINI;
    default:
      return false;
  }
}

function orderByCapability(base: AIProviderName[], taskType: TaskType): AIProviderName[] {
  const matching = base.filter((name) => capabilityRank(name, taskType));
  const rest = base.filter((name) => !matching.includes(name));
  return matching.length > 0 ? [...matching, ...rest] : base;
}

function successRate(stat: MetricSnapshot): string {
  const attempts = stat.success + stat.failure;
  if (attempts === 0) return '0%';
  return `${Math.round((stat.success / attempts) * 100)}%`;
}

function fallbackCount(value: number | null): string {
  return value === null ? '-' : String(value);
}

function displayName(value: string): string {
  if (value === AIProviderName.OPENROUTER) return 'OpenRouter';
  if (value === AIProviderName.HUGGINGFACE) return 'Hugging Face';
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function formatMetric(stat: MetricSnapshot, now: number): string[] {
  return [
    `**${displayName(stat.name)}**`,
    `Success: ${stat.success}`,
    `Failure: ${stat.failure}`,
    `Success Rate: ${successRate(stat)}`,
    `Avg Latency: ${stat.averageLatencyMs}ms`,
    `Last Used: ${formatRelativeTime(stat.lastUsedAt, now)}`,
    `Fallback Count: ${fallbackCount(stat.fallbackCount)}`,
  ];
}

/** Formats provider and OpenRouter model metrics for the /stats command. */
export function formatProviderStats(
  snapshot: ProviderMetricsSnapshot,
  options: FormatterOptions = {},
): string {
  const now = options.now ?? Date.now();
  const lines = ['**AI Provider Stats**', ''];

  if (snapshot.providers.length === 0) {
    lines.push('No provider stats yet.');
  } else {
    snapshot.providers.forEach((stat, index) => {
      if (index > 0) lines.push('');
      lines.push(...formatMetric(stat, now));
    });
  }

  if (snapshot.openRouterModels.length > 0) {
    lines.push('', '**OpenRouter Models**');
    for (const model of snapshot.openRouterModels) {
      lines.push(
        `- \`${model.name}\` | Success: ${model.success} | Failure: ${model.failure} | Success Rate: ${successRate(model)} | Avg Latency: ${model.averageLatencyMs}ms | Last Used: ${formatRelativeTime(model.lastUsedAt, now)}`,
      );
    }
  }

  return lines.join('\n');
}

/** Builds a routing-only debug snapshot without calling an AI provider. */
export function getDebugRoutingSnapshot(
  prompt: string,
  options: DebugRoutingOptions = {},
): DebugRoutingSnapshot {
  const taskType = classifyTask(prompt);
  const configuredProviderOrder = options.providerOrder ?? defaultProviderOrder();
  const capabilityOrder = orderByCapability(configuredProviderOrder, taskType);
  const rankedProviderOrder = rankTargets(capabilityOrder) as AIProviderName[];
  const breaker = options.circuitBreaker ?? defaultCircuitBreaker;
  const skippedProviders = rankedProviderOrder.filter((name) => !breaker.isAvailable(name));
  const selectedProvider =
    rankedProviderOrder.find((name) => breaker.isAvailable(name)) ?? null;

  return {
    prompt,
    taskType,
    configuredProviderOrder,
    rankedProviderOrder,
    skippedProviders,
    selectedProvider,
  };
}

/** Formats routing-only debug output for the /debug-ai command. */
export function formatDebugRouting(snapshot: DebugRoutingSnapshot): string {
  const skipped =
    snapshot.skippedProviders.length === 0
      ? '-'
      : snapshot.skippedProviders.map((name) => `${name} (cooldown)`).join(', ');

  return [
    '**AI Routing Debug**',
    '',
    `Prompt: ${snapshot.prompt}`,
    `Task Type: ${snapshot.taskType.toUpperCase()}`,
    `Configured Provider Order: ${snapshot.configuredProviderOrder.join(', ')}`,
    `Ranked Provider Order: ${snapshot.rankedProviderOrder.join(', ')}`,
    `Skipped Providers: ${skipped}`,
    `Selected First Provider: ${snapshot.selectedProvider ?? 'none'}`,
    '',
    '_No provider call was made._',
  ].join('\n');
}

export function formatProviderOverrideStatus(status: {
  globalOverride: ProviderOverrideMode;
  userOverride: ProviderOverrideMode;
  effectiveOverride: ProviderOverrideMode;
}): string {
  return [
    '**AI Provider Override**',
    '',
    `Global Override: ${status.globalOverride}`,
    `Your Override: ${status.userOverride}`,
    `Effective Override: ${status.effectiveOverride}`,
    '',
    status.effectiveOverride === 'auto'
      ? 'Mode: auto, normal ranking and fallback apply.'
      : `Mode: ${status.effectiveOverride} is forced first, then fallback continues.`,
  ].join('\n');
}

export function formatProviderOverrideSet(
  scope: ProviderOverrideScope,
  provider: ProviderOverrideMode,
): string {
  const label = scope === 'global' ? 'Global' : 'User';
  return `${label} override set to ${provider}.`;
}

export function formatProviderOverrideCleared(scope: ProviderOverrideScope): string {
  const label = scope === 'global' ? 'Global' : 'User';
  return `${label} override cleared.`;
}
