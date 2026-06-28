import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import { getStats } from '../services/ai/providerMetrics';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show AI provider performance statistics');

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  await interaction.reply({
    content: `**Provider Stats**\n\n${getStats()}`,
    ephemeral: true,
  });
}
