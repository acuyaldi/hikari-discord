const COOLDOWN_TIME = 4000;
const cooldowns = new Map<string, number>();

export function checkCooldown(userId: string): boolean {
  const now = Date.now();
  if (cooldowns.has(userId) && now < (cooldowns.get(userId)! + COOLDOWN_TIME)) return true;
  cooldowns.set(userId, now);
  setTimeout(() => cooldowns.delete(userId), COOLDOWN_TIME);
  return false;
}
