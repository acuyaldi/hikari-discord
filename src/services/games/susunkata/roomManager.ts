import { SUSUNKATA_ROOM_TIMEOUT_SECONDS } from '../../../config/env';
import type { WordEntry } from './wordValidator';

export type SusunKataPhase = 'waiting' | 'playing' | 'finished';

export interface SusunKataRoom {
  channelId: string;
  phase: SusunKataPhase;
  creatorId: string;
  guildId: string | null;
  players: Set<string>;
  rounds: number;
  currentRoundIndex: number;
  currentWordEntry: WordEntry | null;
  roundStartedAt: number | null;
  scores: Map<string, number>;
  sentMessageIds: string[];
  createdAt: number;
  updatedAt: number;
  expiryTimer: NodeJS.Timeout | null;
}

interface CreateRoomOptions {
  roomTimeoutMs?: number;
  nowMs?: () => number;
  guildId?: string | null;
}

const rooms = new Map<string, SusunKataRoom>();

function roomTimeoutMs(options: CreateRoomOptions = {}): number {
  return options.roomTimeoutMs ?? SUSUNKATA_ROOM_TIMEOUT_SECONDS * 1000;
}

function clearExpiry(room: SusunKataRoom): void {
  if (room.expiryTimer) {
    clearTimeout(room.expiryTimer);
    room.expiryTimer = null;
  }
}

function armWaitingExpiry(room: SusunKataRoom, timeoutMs: number): void {
  clearExpiry(room);
  room.expiryTimer = setTimeout(() => {
    const latest = rooms.get(room.channelId);
    if (latest === room && latest.phase === 'waiting') {
      destroyRoom(room.channelId);
    }
  }, timeoutMs);
  room.expiryTimer.unref?.();
}

export function createRoom(
  channelId: string,
  creatorId: string,
  rounds: number,
  options: CreateRoomOptions = {},
): SusunKataRoom {
  const existingRoom = rooms.get(channelId);
  if (existingRoom && (existingRoom.phase === 'waiting' || existingRoom.phase === 'playing')) {
    throw new Error('Susun Kata room already exists in this channel');
  }
  if (existingRoom) {
    clearExpiry(existingRoom);
    rooms.delete(channelId);
  }

  const now = options.nowMs?.() ?? Date.now();
  const room: SusunKataRoom = {
    channelId,
    phase: 'waiting',
    creatorId,
    guildId: options.guildId ?? null,
    players: new Set([creatorId]),
    rounds,
    currentRoundIndex: 0,
    currentWordEntry: null,
    roundStartedAt: null,
    scores: new Map(),
    sentMessageIds: [],
    createdAt: now,
    updatedAt: now,
    expiryTimer: null,
  };

  rooms.set(channelId, room);
  armWaitingExpiry(room, roomTimeoutMs(options));
  return room;
}

export function getRoom(channelId: string): SusunKataRoom | null {
  return rooms.get(channelId) ?? null;
}

export function trackRoomMessage(channelId: string, messageId: string | null | undefined): void {
  if (!messageId) return;
  const room = rooms.get(channelId);
  if (!room) return;

  room.sentMessageIds.push(messageId);
  room.updatedAt = Date.now();
}

export function joinRoom(channelId: string, userId: string): SusunKataRoom {
  const room = rooms.get(channelId);
  if (!room) throw new Error('Susun Kata room not found');
  if (room.phase !== 'waiting') throw new Error('Susun Kata room is not joinable');

  room.players.add(userId);
  room.updatedAt = Date.now();
  return room;
}

export function startGame(channelId: string): SusunKataRoom {
  const room = rooms.get(channelId);
  if (!room) throw new Error('Susun Kata room not found');
  if (room.phase !== 'waiting') throw new Error('Susun Kata room is not waiting');
  if (room.players.size < 1) throw new Error('Susun Kata needs at least one player');

  clearExpiry(room);
  room.phase = 'playing';
  room.updatedAt = Date.now();
  return room;
}

export function destroyRoom(channelId: string): void {
  const room = rooms.get(channelId);
  if (!room) return;
  clearExpiry(room);
  room.phase = 'finished';
  rooms.delete(channelId);
}

export function resetSusunKataRoomsForTest(): void {
  for (const room of rooms.values()) clearExpiry(room);
  rooms.clear();
}
