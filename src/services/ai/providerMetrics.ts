import { AIProviderName } from './types';

interface ProviderStat {
  success: number;
  failure: number;
  totalLatencyMs: number;
}

const stats = new Map<AIProviderName, ProviderStat>();
const modelStats = new Map<string, ProviderStat>();

function ensureStat(name: AIProviderName): ProviderStat {
  let s = stats.get(name);
  if (!s) {
    s = { success: 0, failure: 0, totalLatencyMs: 0 };
    stats.set(name, s);
  }
  return s;
}

function ensureModelStat(model: string): ProviderStat {
  let s = modelStats.get(model);
  if (!s) {
    s = { success: 0, failure: 0, totalLatencyMs: 0 };
    modelStats.set(model, s);
  }
  return s;
}

export function recordSuccess(name: AIProviderName, latencyMs: number): void {
  const s = ensureStat(name);
  s.success += 1;
  s.totalLatencyMs += latencyMs;
}

export function recordFailure(name: AIProviderName): void {
  ensureStat(name).failure += 1;
}

export function recordModelSuccess(model: string, latencyMs: number): void {
  const s = ensureModelStat(model);
  s.success += 1;
  s.totalLatencyMs += latencyMs;
}

export function recordModelFailure(model: string): void {
  ensureModelStat(model).failure += 1;
}

export function getStats(): string {
  if (stats.size === 0) return 'No provider stats yet.';

  return Array.from(stats.entries())
    .map(([name, s]) => {
      const avg = s.success > 0 ? Math.round(s.totalLatencyMs / s.success) : 0;
      const lines = [
        `**${name.toUpperCase()}**`,
        `Success: ${s.success} | Failure: ${s.failure}`,
        `Avg Latency: ${avg} ms`,
      ];

      if (name === AIProviderName.OPENROUTER && modelStats.size > 0) {
        for (const [model, ms] of modelStats.entries()) {
          const mAvg = ms.success > 0 ? Math.round(ms.totalLatencyMs / ms.success) : 0;
          lines.push(`  • \`${model}\`: ✓${ms.success} ✗${ms.failure} avg ${mAvg}ms`);
        }
      }

      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}
