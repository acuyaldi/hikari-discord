import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import { listMemories } from '../services/memory/memoryService';
import type { MemoryRow } from '../services/memory/types';

const MAX_VISIBLE_MEMORIES = 15;
const DISCORD_SAFE_CONTENT_LIMIT = 1_900;

export const data = new SlashCommandBuilder()
  .setName('memory')
  .setDescription('Lihat memory yang kusimpan tentang kamu')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('Lihat daftar memory yang kusimpan tentang kamu di server ini'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('stats')
      .setDescription('Lihat ringkasan statistik memory kamu di server ini'),
  );

function formatTimestamp(value: number | null): string {
  if (value === null) return 'belum pernah dipakai';
  return new Date(value).toISOString().slice(0, 10);
}

function formatMemoryLine(memory: MemoryRow, index: number): string {
  const timestamp = memory.last_used_at ?? memory.updated_at;
  return `${index}. #${memory.id} ${memory.memory} (${memory.category}, importance: ${memory.importance}, updated: ${formatTimestamp(timestamp)})`;
}

export function formatMemoryReply(memories: MemoryRow[]): string {
  if (memories.length === 0) {
    return 'Aku belum punya memory tentang kamu di server ini.';
  }

  const visible = memories.slice(0, MAX_VISIBLE_MEMORIES);
  const lines = visible.map((memory, index) => formatMemoryLine(memory, index + 1));
  const footer = memories.length > visible.length
    ? `\n\nMenampilkan ${visible.length} dari ${memories.length} memory.`
    : '';
  const content = `**Memory yang kusimpan tentang kamu**\n\n${lines.join('\n')}${footer}`;

  if (content.length <= DISCORD_SAFE_CONTENT_LIMIT) return content;

  const trimmedLines: string[] = [];
  let current = '**Memory yang kusimpan tentang kamu**\n\n';

  for (const line of lines) {
    const next = `${current}${line}\n`;
    if (`${next}${footer}`.length > DISCORD_SAFE_CONTENT_LIMIT) break;
    trimmedLines.push(line);
    current = next;
  }

  return `**Memory yang kusimpan tentang kamu**\n\n${trimmedLines.join('\n')}${footer}`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce<Record<T, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {} as Record<T, number>);
}

function formatBreakdown(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ');
}

export function formatMemoryStatsReply(memories: MemoryRow[]): string {
  if (memories.length === 0) {
    return 'Belum ada statistik karena memory kamu di server ini masih kosong.';
  }

  const categories = countBy(memories.map((memory) => memory.category));
  const sources = countBy(memories.map((memory) => memory.source));
  const newestUpdated = Math.max(...memories.map((memory) => memory.updated_at));
  const oldestCreated = Math.min(...memories.map((memory) => memory.created_at));

  return [
    '**Statistik memory kamu**',
    '',
    `Total memory: ${memories.length}`,
    `Category: ${formatBreakdown(categories)}`,
    `Rata-rata importance: ${average(memories.map((memory) => memory.importance))}`,
    `Rata-rata confidence: ${average(memories.map((memory) => memory.confidence))}`,
    `Newest updated: ${formatTimestamp(newestUpdated)}`,
    `Oldest created: ${formatTimestamp(oldestCreated)}`,
    `Source: ${formatBreakdown(sources)}`,
  ].join('\n');
}

function getMemorySubcommand(interaction: ChatInputCommandInteraction): 'list' | 'stats' {
  const maybeOptions = interaction.options as ChatInputCommandInteraction['options'] & {
    getSubcommand?: (required?: boolean) => string | null;
  };
  const subcommand = maybeOptions.getSubcommand?.(false);
  return subcommand === 'stats' ? 'stats' : 'list';
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  const result = listMemories(interaction.user.id);

  if (!result.success) {
    await interaction.reply({
      content: 'Aku belum bisa membuka memory kamu sekarang.',
      ephemeral: true,
    });
    return;
  }

  const guildMemories = result.data.filter((memory) => memory.guild_id === interaction.guildId);
  const subcommand = getMemorySubcommand(interaction);

  await interaction.reply({
    content: subcommand === 'stats'
      ? formatMemoryStatsReply(guildMemories)
      : formatMemoryReply(guildMemories),
    ephemeral: true,
  });
}
