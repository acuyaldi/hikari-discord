import { AI_PROVIDER_ORDER } from '../../config/env';
import { classifyTask } from '../../ai/router';
import { circuitBreaker as defaultCircuitBreaker, type CircuitBreaker } from './circuitBreaker';
import type { ProviderOverrideMode, ProviderOverrideScope } from './providerOverride';
import { rankTargets } from './providerRanking';
import { AIProviderName, TaskType } from './types';

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
