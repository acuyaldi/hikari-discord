import { DEBUG_AI } from '../../config/env';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'cooldown' | 'unknown';

export interface ProviderHealthState {
  target: string;
  status: ProviderHealthStatus;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  averageLatencyMs: number;
  lastLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  cooldownUntil: number | null;
}

const healthStates = new Map<string, ProviderHealthState>();
const DEBUG = DEBUG_AI;

function defaultState(target: string): ProviderHealthState {
  return {
    target,
    status: 'unknown',
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    averageLatencyMs: 0,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    cooldownUntil: null,
  };
}

function errorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message;
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

function setStatus(state: ProviderHealthState, status: ProviderHealthStatus): void {
  const previous = state.status;
  state.status = status;

  if (DEBUG && previous !== status) {
    console.log(`[Health Cache] ${state.target} ${previous} -> ${status}`);
  }
}

function ensureState(target: string): ProviderHealthState {
  const existing = healthStates.get(target);
  if (existing) return existing;

  const created = defaultState(target);
  healthStates.set(target, created);
  return created;
}

function cloneState(state: ProviderHealthState): ProviderHealthState {
  return { ...state };
}

/** Records a successful provider or model call with its observed latency. */
export function recordHealthSuccess(target: string, latencyMs: number): void {
  try {
    const state = ensureState(target);
    const safeLatencyMs = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
    const totalLatency = state.averageLatencyMs * state.successCount + safeLatencyMs;

    state.successCount += 1;
    state.consecutiveFailures = 0;
    state.averageLatencyMs = Math.round(totalLatency / state.successCount);
    state.lastLatencyMs = safeLatencyMs;
    state.lastSuccessAt = Date.now();
    state.lastError = null;
    state.cooldownUntil = null;
    setStatus(state, 'healthy');
  } catch {
    // Health cache must never affect provider behavior.
  }
}

/** Records a failed provider or model call and marks transient failures as degraded. */
export function recordHealthFailure(
  target: string,
  error: unknown,
  isTransient: boolean,
): void {
  try {
    const state = ensureState(target);
    state.failureCount += 1;
    state.consecutiveFailures += 1;
    state.lastFailureAt = Date.now();
    state.lastError = errorMessage(error);

    if (isTransient) {
      setStatus(state, 'degraded');
    }
  } catch {
    // Health cache must never affect provider behavior.
  }
}

/** Marks a provider or model as cooling down until the supplied epoch timestamp. */
export function markCooldown(target: string, cooldownUntil: number, error?: unknown): void {
  try {
    const state = ensureState(target);
    state.cooldownUntil = Number.isFinite(cooldownUntil) ? cooldownUntil : null;
    if (error !== undefined) {
      state.lastError = errorMessage(error);
    }
    setStatus(state, 'cooldown');
  } catch {
    // Health cache must never affect provider behavior.
  }
}

/** Returns the current health state for a target, or an unknown default state. */
export function getHealth(target: string): ProviderHealthState {
  try {
    return cloneState(healthStates.get(target) ?? defaultState(target));
  } catch {
    return defaultState(target);
  }
}

/** Returns all tracked health states. */
export function getAllHealth(): ProviderHealthState[] {
  try {
    return Array.from(healthStates.values()).map(cloneState);
  } catch {
    return [];
  }
}

/** Clears one target from the health cache, or all targets when omitted. */
export function resetHealth(target?: string): void {
  try {
    if (target === undefined) {
      healthStates.clear();
      return;
    }

    healthStates.delete(target);
  } catch {
    // Health cache must never affect provider behavior.
  }
}
