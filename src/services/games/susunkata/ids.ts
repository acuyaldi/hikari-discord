export type SusunKataComponentId =
  | { kind: 'join'; channelId: string }
  | { kind: 'start'; channelId: string }
  | { kind: 'cancel'; channelId: string };

const PREFIX = 'sk';

export function buildSusunKataJoinId(channelId: string): string {
  return `${PREFIX}:join:${channelId}`;
}

export function buildSusunKataStartId(channelId: string): string {
  return `${PREFIX}:start:${channelId}`;
}

export function buildSusunKataCancelId(channelId: string): string {
  return `${PREFIX}:cancel:${channelId}`;
}

export function parseSusunKataComponentId(value: string): SusunKataComponentId | null {
  const parts = value.split(':');
  if (parts[0] !== PREFIX || !parts[2]) return null;

  if (parts[1] === 'join') return { kind: 'join', channelId: parts[2] };
  if (parts[1] === 'start') return { kind: 'start', channelId: parts[2] };
  if (parts[1] === 'cancel') return { kind: 'cancel', channelId: parts[2] };

  return null;
}
