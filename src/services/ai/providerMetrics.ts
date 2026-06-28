import { AIProviderName } from './types';

interface ProviderStat {
  success: number;
  failure: number;
  totalLatencyMs: number;
}

const stats = new Map<AIProviderName, ProviderStat>();

function ensureStat(name: AIProviderName): ProviderStat {
  let s = stats.get(name);
  if (!s) {
    s = { success: 0, failure: 0, totalLatencyMs: 0 };
    stats.set(name, s);
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

export function getStats(): string {
  if (stats.size === 0) return 'No provider stats yet.';

  return Array.from(stats.entries())
    .map(([name, s]) => {
      const avg = s.success > 0 ? Math.round(s.totalLatencyMs / s.success) : 0;
      return [
        `**${name.toUpperCase()}**`,
        `Success: ${s.success} | Failure: ${s.failure}`,
        `Avg Latency: ${avg} ms`,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}
