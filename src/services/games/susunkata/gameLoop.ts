import { EmbedBuilder, type Client, type Message } from 'discord.js';
import type Database from 'better-sqlite3';

import dbDefault from '../../../database/sqlite';
import {
  DEBUG_AI,
  SUSUNKATA_CLEANUP_DELAY_MINUTES,
  SUSUNKATA_POINTS_PER_ROUND,
  SUSUNKATA_ROUND_TIMEOUT_SECONDS,
  SUSUNKATA_ROUND_TRANSITION_DELAY_MS,
} from '../../../config/env';
import { destroyRoom, finishRoom, getRoom, trackRoomMessage } from './roomManager';
import { scrambleWord } from './scrambler';
import { getValidatedWordBatch } from './wordGenerator';
import type { WordEntry } from './wordValidator';

interface RunGameDependencies {
  db?: Database.Database;
  getWords?: (count: number) => Promise<WordEntry[]>;
  roundTimeoutMs?: number;
  transitionDelayMs?: number;
  cleanupDelayMs?: number;
  pointsPerRound?: number;
  nowMs?: () => number;
}

type AnswerMessage = Pick<Message, 'content'> & {
  channel: { id: string };
  author: { id: string; bot?: boolean };
};

type AnswerHandler = (message: AnswerMessage) => Promise<boolean>;
type GameMessage = {
  id?: string;
  edit: (payload: unknown) => Promise<unknown>;
};
type GameChannel = { send: (payload: unknown) => Promise<GameMessage> };
type DeletableChannel = GameChannel & {
  messages?: {
    fetch: (messageId: string) => Promise<{ delete: () => Promise<unknown> }>;
  };
};

const activeAnswerHandlers = new Map<string, AnswerHandler>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addLeaderboardPoints(
  db: Database.Database,
  guildId: string,
  userId: string,
  delta: number,
): void {
  db.prepare(
    `INSERT INTO trivia_scores (guild_id, user_id, points)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id)
     DO UPDATE SET points = MAX(0, points + excluded.points)`,
  ).run(guildId, userId, delta);
}

function buildRoundEmbed(input: {
  entry: WordEntry;
  roundNumber: number;
  totalRounds: number;
  endSeconds: number;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Susun Kata - Ronde ${input.roundNumber}/${input.totalRounds}`)
    .setDescription(
      [
        `Huruf: **${scrambleWord(input.entry.word)}**`,
        `Petunjuk: ${input.entry.clue}`,
        `Waktu: <t:${input.endSeconds}:R>`,
        '',
        'Ketik jawaban di channel ini. Pemain tercepat yang benar dapat poin.',
      ].join('\n'),
    );
}

function buildResultEmbed(input: {
  entry: WordEntry;
  winnerId: string | null;
  elapsedMs: number | null;
}): EmbedBuilder {
  const winnerText = input.winnerId
    ? `<@${input.winnerId}> menjawab benar${input.elapsedMs === null ? '.' : ` dalam ${(input.elapsedMs / 1000).toFixed(1)} detik.`}`
    : `Waktu habis. Jawabannya: **${input.entry.word.toUpperCase()}**`;

  return new EmbedBuilder()
    .setColor(input.winnerId ? 0x57f287 : 0xed4245)
    .setTitle(input.winnerId ? 'Ronde Selesai' : 'Tidak Ada yang Benar')
    .setDescription(winnerText);
}

function buildFinalEmbed(roomPlayers: string[], scores: Map<string, number>): EmbedBuilder {
  const rows = roomPlayers
    .map((userId) => ({ userId, score: scores.get(userId) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  const medals = ['🥇', '🥈', '🥉'];
  const description = rows
    .map((row, index) => `${medals[index] ?? '•'} **#${index + 1}** <@${row.userId}> - **${row.score}** poin`)
    .join('\n');

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Podium Susun Kata')
    .setDescription(description || 'Belum ada skor.');
}

async function fetchTextChannel(client: Client, channelId: string): Promise<GameChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !('send' in channel)) return null;
  return channel as never;
}

async function sendGameMessage(
  channel: GameChannel,
  channelId: string,
  payload: unknown,
): Promise<GameMessage> {
  const message = await channel.send(payload);
  trackRoomMessage(channelId, message.id);
  return message;
}

function scheduleMessageCleanup(
  client: Client,
  channelId: string,
  messageIds: string[],
  delayMs: number,
): void {
  const uniqueMessageIds = Array.from(new Set(messageIds.filter(Boolean)));
  if (uniqueMessageIds.length === 0) return;

  const timer = setTimeout(async () => {
    let deleted = 0;
    let skipped = 0;
    const channel = await fetchTextChannel(client, channelId).catch(() => null) as DeletableChannel | null;

    if (!channel?.messages?.fetch) {
      skipped = uniqueMessageIds.length;
    } else {
      for (const messageId of uniqueMessageIds) {
        try {
          const message = await channel.messages.fetch(messageId);
          await message.delete();
          deleted += 1;
        } catch {
          skipped += 1;
        }
      }
    }

    if (DEBUG_AI) {
      console.log(`[SusunKata] cleanup complete deleted=${deleted} skipped=${skipped}`);
    }
  }, delayMs);

  timer.unref?.();
}

async function playRound(
  roomChannelId: string,
  channel: GameChannel,
  entry: WordEntry,
  roundNumber: number,
  totalRounds: number,
  dependencies: Required<Pick<RunGameDependencies, 'roundTimeoutMs' | 'pointsPerRound' | 'nowMs'>>,
): Promise<void> {
  const room = getRoom(roomChannelId);
  if (!room) return;

  room.currentRoundIndex = roundNumber - 1;
  room.currentWordEntry = entry;
  room.roundStartedAt = dependencies.nowMs();

  let resolved = false;
  let winnerId: string | null = null;
  let elapsedMs: number | null = null;
  let finishRound: (() => void) | null = null;

  const message = await sendGameMessage(channel, roomChannelId, {
    embeds: [
      buildRoundEmbed({
        entry,
        roundNumber,
        totalRounds,
        endSeconds: Math.floor((dependencies.nowMs() + dependencies.roundTimeoutMs) / 1000),
      }),
    ],
  });

  const finishPromise = new Promise<void>((resolve) => {
    finishRound = resolve;
  });

  const timer = setTimeout(() => {
    if (resolved) return;
    resolved = true;
    activeAnswerHandlers.delete(roomChannelId);
    finishRound?.();
  }, dependencies.roundTimeoutMs);

  activeAnswerHandlers.set(roomChannelId, async (answerMessage) => {
    const latestRoom = getRoom(roomChannelId);
    if (!latestRoom || latestRoom.phase !== 'playing') return false;
    if (!latestRoom.players.has(answerMessage.author.id)) return false;

    const answer = answerMessage.content.trim().toLowerCase();
    if (answer !== entry.word.trim().toLowerCase()) return true;
    if (resolved) return true;

    resolved = true;
    winnerId = answerMessage.author.id;
    elapsedMs = dependencies.nowMs() - (latestRoom.roundStartedAt ?? dependencies.nowMs());
    latestRoom.scores.set(
      winnerId,
      (latestRoom.scores.get(winnerId) ?? 0) + dependencies.pointsPerRound,
    );
    clearTimeout(timer);
    activeAnswerHandlers.delete(roomChannelId);
    finishRound?.();
    return true;
  });

  await finishPromise;
  await message.edit({
    embeds: [buildResultEmbed({ entry, winnerId, elapsedMs })],
  });
}

export async function handleSusunKataAnswerMessage(message: AnswerMessage): Promise<boolean> {
  if (message.author.bot) return false;
  const handler = activeAnswerHandlers.get(message.channel.id);
  if (!handler) return false;

  const room = getRoom(message.channel.id);
  if (!room || room.phase !== 'playing' || !room.players.has(message.author.id)) {
    return false;
  }

  return handler(message);
}

export async function runGame(
  channelId: string,
  client: Client,
  dependencies: RunGameDependencies = {},
): Promise<void> {
  const room = getRoom(channelId);
  if (!room) return;

  const db = dependencies.db ?? dbDefault;
  const getWords = dependencies.getWords ?? getValidatedWordBatch;
  const roundTimeoutMs = dependencies.roundTimeoutMs ?? SUSUNKATA_ROUND_TIMEOUT_SECONDS * 1000;
  const transitionDelayMs = dependencies.transitionDelayMs ?? SUSUNKATA_ROUND_TRANSITION_DELAY_MS;
  const cleanupDelayMs = dependencies.cleanupDelayMs
    ?? SUSUNKATA_CLEANUP_DELAY_MINUTES * 60 * 1000;
  const pointsPerRound = dependencies.pointsPerRound ?? SUSUNKATA_POINTS_PER_ROUND;
  const nowMs = dependencies.nowMs ?? Date.now;

  try {
    const channel = await fetchTextChannel(client, channelId);
    if (!channel) throw new Error('Susun Kata channel not found');

    const words = await getWords(room.rounds);
    const playableWords = words.slice(0, room.rounds);

    if (playableWords.length === 0) {
      await sendGameMessage(channel, channelId, 'Susun Kata gagal dimulai karena belum ada kata valid.');
      return;
    }

    for (let index = 0; index < playableWords.length; index += 1) {
      await playRound(
        channelId,
        channel,
        playableWords[index]!,
        index + 1,
        playableWords.length,
        {
          roundTimeoutMs,
          pointsPerRound,
          nowMs,
        },
      );

      if (index < playableWords.length - 1) {
        await delay(transitionDelayMs);
      }
    }

    const latestRoom = getRoom(channelId);
    if (!latestRoom) return;
    finishRoom(channelId, latestRoom);

    for (const [userId, score] of latestRoom.scores.entries()) {
      if (score > 0) {
        addLeaderboardPoints(db, latestRoom.guildId ?? 'guild-1', userId, score);
      }
    }

    await sendGameMessage(channel, channelId, {
      embeds: [buildFinalEmbed(Array.from(latestRoom.players), latestRoom.scores)],
    });
  } catch (error) {
    console.error('[SusunKata] game loop failed:', error);
  } finally {
    const messageIds = [...room.sentMessageIds];
    activeAnswerHandlers.delete(channelId);
    destroyRoom(channelId, room);
    scheduleMessageCleanup(client, channelId, messageIds, cleanupDelayMs);
  }
}
