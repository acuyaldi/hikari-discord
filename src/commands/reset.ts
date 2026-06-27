import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../types';
import { clearMemory } from '../services/chatMemory';

export const data = new SlashCommandBuilder()
  .setName('reset')
  .setDescription('Menghapus ingatan Hikari di channel ini ✨');

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  clearMemory(interaction.channelId);
  await interaction.reply(
    '✨ *Poof!* Sirkuit ingatan Hikari di channel ini sudah di-reset! Mari mulai dari lembaran baru, Senpai! 🌸',
  );
}
