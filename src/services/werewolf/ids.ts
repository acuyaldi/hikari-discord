export type WerewolfNightAction = 'inspect' | 'kill';

export type WerewolfComponentId =
  | { kind: 'join'; guildId: string }
  | { kind: 'launch'; guildId: string }
  | { kind: 'night-action'; guildId: string; action: WerewolfNightAction }
  | { kind: 'night-target'; guildId: string; action: WerewolfNightAction }
  | { kind: 'vote'; guildId: string };

const PREFIX = 'ww';

export function buildWerewolfJoinId(guildId: string): string {
  return `${PREFIX}:join:${guildId}`;
}

export function buildWerewolfLaunchId(guildId: string): string {
  return `${PREFIX}:launch:${guildId}`;
}

export function buildWerewolfNightActionId(guildId: string, action: WerewolfNightAction): string {
  return `${PREFIX}:night-action:${guildId}:${action}`;
}

export function buildWerewolfNightTargetId(guildId: string, action: WerewolfNightAction): string {
  return `${PREFIX}:night-target:${guildId}:${action}`;
}

export function buildWerewolfVoteId(guildId: string): string {
  return `${PREFIX}:vote:${guildId}`;
}

export function parseWerewolfComponentId(value: string): WerewolfComponentId | null {
  const parts = value.split(':');
  if (parts[0] !== PREFIX) return null;

  if (parts[1] === 'join' && parts[2]) return { kind: 'join', guildId: parts[2] };
  if (parts[1] === 'launch' && parts[2]) return { kind: 'launch', guildId: parts[2] };
  if (parts[1] === 'night-action' && parts[2] && (parts[3] === 'inspect' || parts[3] === 'kill')) {
    return { kind: 'night-action', guildId: parts[2], action: parts[3] };
  }
  if (parts[1] === 'night-target' && parts[2] && (parts[3] === 'inspect' || parts[3] === 'kill')) {
    return { kind: 'night-target', guildId: parts[2], action: parts[3] };
  }
  if (parts[1] === 'vote' && parts[2]) return { kind: 'vote', guildId: parts[2] };

  return null;
}