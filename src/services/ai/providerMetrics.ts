import { AIProviderName } from './types';

interface ProviderStat {
  success: number;
  failure: number;
  totalLatencyMs: number;
  lastUsedAt: number | null;
}

const stats = new Map<AIProviderName, ProviderStat>();
const modelStats = new Map<string, ProviderStat>();

export interface MetricSnapshot {
  name: string;
  success: number;
  failure: number;
  averageLatencyMs: number;
  lastUsedAt: number | null;
  fallbackCount: number | null;
}

export interface ProviderMetricsSnapshot {
  providers: MetricSnapshot[];
  openRouterModels: MetricSnapshot[];
}

function ensureStat(name: AIProviderName): ProviderStat {
  let s = stats.get(name);
  if (!s) {
    s = { success: 0, failure: 0, totalLatencyMs: 0, lastUsedAt: null };
    stats.set(name, s);
  }
  return s;
}

function ensureModelStat(model: string): ProviderStat {
  let s = modelStats.get(model);
  if (!s) {
    s = { success: 0, failure: 0, totalLatencyMs: 0, lastUsedAt: null };
    modelStats.set(model, s);
  }
  return s;
}

export function recordSuccess(name: AIProviderName, latencyMs: number): void {
  const s = ensureStat(name);
  s.success += 1;
  s.totalLatencyMs += latencyMs;
  s.lastUsedAt = Date.now();
}

export function recordFailure(name: AIProviderName): void {
  const s = ensureStat(name);
  s.failure += 1;
  s.lastUsedAt = Date.now();
}

export function recordModelSuccess(model: string, latencyMs: number): void {
  const s = ensureModelStat(model);
  s.success += 1;
  s.totalLatencyMs += latencyMs;
  s.lastUsedAt = Date.now();
}

export function recordModelFailure(model: string): void {
  const s = ensureModelStat(model);
  s.failure += 1;
  s.lastUsedAt = Date.now();
}

function toSnapshot(name: string, stat: ProviderStat): MetricSnapshot {
  const averageLatencyMs = stat.success > 0 ? Math.round(stat.totalLatencyMs / stat.success) : 0;
  return {
    name,
    success: stat.success,
    failure: stat.failure,
    averageLatencyMs,
    lastUsedAt: stat.lastUsedAt,
    fallbackCount: null,
  };
}

export function getProviderMetricsSnapshot(): ProviderMetricsSnapshot {
  return {
    providers: Array.from(stats.entries()).map(([name, stat]) => toSnapshot(name, stat)),
    openRouterModels: Array.from(modelStats.entries()).map(([name, stat]) =>
      toSnapshot(name, stat),
    ),
  };
}

export function resetProviderMetrics(): void {
  stats.clear();
  modelStats.clear();
}

