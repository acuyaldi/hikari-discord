import { AIProviderName } from './types';

export type ProviderOverrideMode = 'auto' | AIProviderName;
export type ProviderOverrideScope = 'user' | 'global';

export interface ProviderOverridesSnapshot {
  global: ProviderOverrideMode;
  users: Record<string, ProviderOverrideMode>;
}

const VALID_OVERRIDES = new Set<string>(['auto', ...Object.values(AIProviderName)]);
let globalOverride: ProviderOverrideMode = 'auto';
const userOverrides = new Map<string, ProviderOverrideMode>();

function parseProviderOverride(provider: string): ProviderOverrideMode | null {
  const normalized = provider.trim().toLowerCase();
  return VALID_OVERRIDES.has(normalized) ? (normalized as ProviderOverrideMode) : null;
}

export function setGlobalProviderOverride(provider: string): boolean {
  const parsed = parseProviderOverride(provider);
  if (parsed === null) return false;
  globalOverride = parsed;
  return true;
}

export function clearGlobalProviderOverride(): void {
  globalOverride = 'auto';
}

export function getGlobalProviderOverride(): ProviderOverrideMode {
  return globalOverride;
}

export function setUserProviderOverride(userId: string, provider: string): boolean {
  const parsed = parseProviderOverride(provider);
  if (parsed === null) return false;

  if (parsed === 'auto') {
    userOverrides.delete(userId);
    return true;
  }

  userOverrides.set(userId, parsed);
  return true;
}

export function clearUserProviderOverride(userId: string): void {
  userOverrides.delete(userId);
}

export function getUserProviderOverride(userId: string): ProviderOverrideMode {
  return userOverrides.get(userId) ?? 'auto';
}

export function resolveProviderOverride(userId: string): ProviderOverrideMode {
  return userOverrides.get(userId) ?? globalOverride;
}

export function getAllProviderOverrides(): ProviderOverridesSnapshot {
  return {
    global: globalOverride,
    users: Object.fromEntries(userOverrides.entries()),
  };
}
