import {
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} from '../../config/env';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

export interface CircuitBreakerState {
  failureCount: number;
  isOpen: boolean;
  openedUntil?: number;
  lastError?: string;
}

interface StoredCircuitBreakerState {
  failureCount: number;
  openedUntil?: number;
  lastError?: string;
}

function hasNumberProperty(value: unknown, property: string): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    property in value &&
    typeof (value as Record<string, unknown>)[property] === 'number'
  );
}

function hasStringProperty(value: unknown, property: string): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    property in value &&
    typeof (value as Record<string, unknown>)[property] === 'string'
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isTransientAIError(error: unknown): boolean {
  if (hasNumberProperty(error, 'status')) {
    const { status } = error;
    return status === 429 || status >= 500;
  }

  if (hasNumberProperty(error, 'statusCode')) {
    const { statusCode } = error;
    return statusCode === 429 || statusCode >= 500;
  }

  if (hasStringProperty(error, 'code')) {
    const code = error.code.toUpperCase();
    if (
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNABORTED' ||
      code === 'UND_ERR_HEADERS_TIMEOUT'
    ) {
      return true;
    }
  }

  const message = errorMessage(error).toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
}

export function isQuotaOrRateLimitAIError(error: unknown): boolean {
  if (hasNumberProperty(error, 'status') && error.status === 429) return true;
  if (hasNumberProperty(error, 'statusCode') && error.statusCode === 429) return true;

  if (hasStringProperty(error, 'code')) {
    const code = error.code.toUpperCase();
    if (code === 'RESOURCE_EXHAUSTED' || code === 'RATE_LIMIT_EXCEEDED') return true;
  }

  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('rate-limit') ||
    message.includes('too many requests')
  );
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly states = new Map<string, StoredCircuitBreakerState>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? CIRCUIT_BREAKER_COOLDOWN_MS;
  }

  isAvailable(target: string): boolean {
    const state = this.states.get(target);
    if (!state?.openedUntil) return true;

    if (Date.now() >= state.openedUntil) {
      state.openedUntil = undefined;
      return true;
    }

    return false;
  }

  recordSuccess(target: string): void {
    this.states.set(target, { failureCount: 0 });
  }

  recordFailure(target: string, error: unknown): void {
    const current = this.states.get(target) ?? { failureCount: 0 };
    current.lastError = errorMessage(error);

    if (isTransientAIError(error)) {
      current.failureCount += 1;
      if (current.failureCount >= this.failureThreshold) {
        current.openedUntil = Date.now() + this.cooldownMs;
      }
    }

    this.states.set(target, current);
  }

  getState(target: string): CircuitBreakerState {
    const state = this.states.get(target) ?? { failureCount: 0 };
    return {
      failureCount: state.failureCount,
      isOpen: !this.isAvailable(target),
      openedUntil: state.openedUntil,
      lastError: state.lastError,
    };
  }

  getAllStates(): Record<string, CircuitBreakerState> {
    return Object.fromEntries(
      Array.from(this.states.keys()).map((target) => [target, this.getState(target)]),
    );
  }

  reset(target?: string): void {
    if (target === undefined) {
      this.states.clear();
      return;
    }

    this.states.delete(target);
  }
}

export const circuitBreaker = new CircuitBreaker();
