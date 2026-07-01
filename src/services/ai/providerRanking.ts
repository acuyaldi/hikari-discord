import { getHealth } from './healthCache';

const BASE_SCORE = 100;

/** Calculates a deterministic health score for a provider or model target. */
export function scoreHealth(target: string): number {
  const health = getHealth(target);
  const attempts = health.successCount + health.failureCount;
  const successRate = attempts > 0 ? health.successCount / attempts : 0;
  const failureRate = attempts > 0 ? health.failureCount / attempts : 0;

  let score = BASE_SCORE;
  score += successRate * 50;
  score -= health.averageLatencyMs / 100;
  score -= health.consecutiveFailures * 20;
  score -= failureRate * 30;

  switch (health.status) {
    case 'healthy':
      score += 20;
      break;
    case 'degraded':
      score -= 30;
      break;
    case 'cooldown':
      score -= 9_999;
      break;
    case 'unknown':
      break;
  }

  return score;
}

/** Ranks targets by health score while preserving the input order for ties. */
export function rankTargets(targets: string[]): string[] {
  return targets
    .map((target, index) => ({ target, index, score: scoreHealth(target) }))
    .sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return a.index - b.index;
    })
    .map(({ target }) => target);
}
