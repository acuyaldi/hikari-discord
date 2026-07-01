import { COOLDOWN_SECONDS, DEBUG_AI } from '../config/env';

export const COOLDOWN_TIME = COOLDOWN_SECONDS * 1000;
const cooldowns = new Map<string, number>();

export function checkCooldown(userId: string): boolean {
  try {
    const now = Date.now();
    const lastRequestAt = cooldowns.get(userId);
    if (lastRequestAt !== undefined && now < lastRequestAt + COOLDOWN_TIME) return true;
    cooldowns.set(userId, now);
    return false;
  } catch (error) {
    if (DEBUG_AI) {
      console.error('[Cooldown]\nfailed open:', error);
    }
    return false;
  }
}

export function clearCooldowns(): void {
  cooldowns.clear();
}
