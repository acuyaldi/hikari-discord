import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import { existsMemory, saveMemory } from '../services/memory/memoryService';
import { MemorySource } from '../services/memory/types';

const MIN_MEMORY_LENGTH = 12;
const MAX_MEMORY_LENGTH = 500;
const MANUAL_MEMORY_CATEGORY = 'other';
const MANUAL_MEMORY_IMPORTANCE = 90;
const MANUAL_MEMORY_CONFIDENCE = 100;

export const data = new SlashCommandBuilder()
  .setName('remember')
  .setDescription('Minta Hikari menyimpan memory tentang kamu')
  .addStringOption((option) =>
    option
      .setName('memory')
      .setDescription('Memory yang ingin kamu simpan')
      .setRequired(true)
      .setMaxLength(MAX_MEMORY_LENGTH),
  );

function validateMemoryText(rawMemory: string | null): string | null {
  const memory = rawMemory?.trim() ?? '';
  if (memory.length < MIN_MEMORY_LENGTH) return null;
  if (memory.length > MAX_MEMORY_LENGTH) return null;
  return memory;
}

function invalidMemoryMessage(rawMemory: string | null): string {
  const memory = rawMemory?.trim() ?? '';
  if (memory.length > MAX_MEMORY_LENGTH) {
    return `Memory itu terlalu panjang. Coba ringkas jadi maksimal ${MAX_MEMORY_LENGTH} karakter ya.`;
  }
  return 'Memory itu terlalu pendek. Tulis sedikit lebih lengkap supaya Hikari bisa menyimpannya dengan jelas.';
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  const rawMemory = interaction.options.getString('memory', true);
  const memory = validateMemoryText(rawMemory);

  if (memory === null) {
    await interaction.reply({
      content: invalidMemoryMessage(rawMemory),
      ephemeral: true,
    });
    return;
  }

  const existsResult = existsMemory(interaction.user.id, MANUAL_MEMORY_CATEGORY, memory);

  if (!existsResult.success) {
    await interaction.reply({
      content: 'Gomen, Hikari belum bisa mengecek memory itu sekarang.',
      ephemeral: true,
    });
    return;
  }

  if (existsResult.data) {
    await interaction.reply({
      content: 'Memory itu sudah tersimpan, jadi Hikari tidak menambah duplikat.',
      ephemeral: true,
    });
    return;
  }

  const saveResult = saveMemory({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    category: MANUAL_MEMORY_CATEGORY,
    memory,
    importance: MANUAL_MEMORY_IMPORTANCE,
    confidence: MANUAL_MEMORY_CONFIDENCE,
    source: MemorySource.MANUAL,
  });

  await interaction.reply({
    content: saveResult.success
      ? 'Oke, memory itu sudah Hikari simpan.'
      : 'Gomen, Hikari belum bisa menyimpan memory itu sekarang.',
    ephemeral: true,
  });
}
