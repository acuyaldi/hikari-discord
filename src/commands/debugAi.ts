import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import { formatDebugRouting, getDebugRoutingSnapshot } from '../services/ai/aiDebugFormatter';

export const data = new SlashCommandBuilder()
  .setName('debug-ai')
  .setDescription('Preview AI routing without calling a provider')
  .addStringOption((option) =>
    option
      .setName('prompt')
      .setDescription('Prompt text to classify and route')
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  const prompt = interaction.options.getString('prompt', true);

  await interaction.reply({
    content: formatDebugRouting(getDebugRoutingSnapshot(prompt)),
    ephemeral: true,
  });
}
