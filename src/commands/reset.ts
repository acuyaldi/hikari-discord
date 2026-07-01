import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../types';
import { clearMemory } from '../services/chatMemory';

export const data = new SlashCommandBuilder()
  .setName('reset')
  .setDescription('Reset ingatan Hikari di channel ini');

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  clearMemory(interaction.channelId);
  await interaction.reply(
    'Oke, riwayat obrolan di channel ini sudah direset. Kita mulai lagi dari nol.',
  );
}
