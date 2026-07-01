import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import { deleteMemory, listMemories } from '../services/memory/memoryService';
import type { MemoryRow } from '../services/memory/types';

const MIN_QUERY_LENGTH = 2;
const MAX_CANDIDATES_SHOWN = 5;

export const data = new SlashCommandBuilder()
  .setName('forget')
  .setDescription('Hapus memory yang Hikari simpan tentang kamu')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('ID, nomor, atau kata dari memory yang ingin dihapus')
      .setRequired(true),
  );

function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractTokens(text: string): string[] {
  return Array.from(new Set(normalizeQuery(text).match(/[a-z0-9]+/g) ?? []))
    .filter((token) => token.length > 1);
}

function formatCandidate(memory: MemoryRow, index: number): string {
  return `${index}. #${memory.id} ${memory.memory} (${memory.category})`;
}

function findMatchingMemories(query: string, memories: MemoryRow[]): MemoryRow[] {
  const normalizedQuery = normalizeQuery(query);
  const numericQuery = Number(normalizedQuery);

  if (Number.isInteger(numericQuery)) {
    const byId = memories.find((memory) => memory.id === numericQuery);
    if (byId !== undefined) return [byId];

    const byDisplayNumber = memories[numericQuery - 1];
    return byDisplayNumber !== undefined ? [byDisplayNumber] : [];
  }

  const queryTokens = extractTokens(query);

  return memories.filter((memory) => {
    const normalizedMemory = normalizeQuery(memory.memory);
    if (normalizedMemory === normalizedQuery) return true;
    if (normalizedMemory.includes(normalizedQuery)) return true;

    const memoryTokens = extractTokens(memory.memory);
    return queryTokens.length > 1 && queryTokens.every((token) => memoryTokens.includes(token));
  });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  const query = interaction.options.getString('query', true).trim();
  const numericQuery = Number(query);

  if (query.length < MIN_QUERY_LENGTH && !Number.isInteger(numericQuery)) {
    await interaction.reply({
      content: 'Query itu terlalu pendek. Tulis ID, nomor, atau beberapa kata dari memory yang mau dihapus.',
      ephemeral: true,
    });
    return;
  }

  const memoriesResult = listMemories(interaction.user.id);

  if (!memoriesResult.success) {
    await interaction.reply({
      content: 'Aku belum bisa membuka daftar memory kamu sekarang.',
      ephemeral: true,
    });
    return;
  }

  const guildMemories = memoriesResult.data.filter((memory) => memory.guild_id === interaction.guildId);
  const matches = findMatchingMemories(query, guildMemories);

  if (matches.length === 0) {
    await interaction.reply({
      content: 'Aku tidak menemukan memory yang cocok di server ini.',
      ephemeral: true,
    });
    return;
  }

  if (matches.length > 1) {
    await interaction.reply({
      content:
        'Aku menemukan beberapa memory yang mirip. Coba lebih spesifik:\n\n' +
        matches.slice(0, MAX_CANDIDATES_SHOWN).map(formatCandidate).join('\n'),
      ephemeral: true,
    });
    return;
  }

  const target = matches[0];
  const deleteResult = deleteMemory(target.id);

  await interaction.reply({
    content: deleteResult.success
      ? `Sip, memory #${target.id} sudah aku hapus.`
      : 'Aku belum bisa menghapus memory itu sekarang.',
    ephemeral: true,
  });
}
