import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import { circuitBreaker } from '../services/ai/circuitBreaker';
import {
  formatHealthDashboard,
  formatHealthResetResult,
} from '../services/ai/healthFormatter';
import { getAllHealth, resetHealth } from '../services/ai/healthCache';
import { splitMessage } from '../utils/splitmessage';

const DISCORD_SAFE_CONTENT_LIMIT = 1_900;

export const data = new SlashCommandBuilder()
  .setName('health')
  .setDescription('Show AI provider and model health')
  .addSubcommand((subcommand) =>
    subcommand.setName('status').setDescription('Show AI provider and model health'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reset')
      .setDescription('Reset AI health and circuit breaker state')
      .addStringOption((option) =>
        option
          .setName('target')
          .setDescription('Optional provider/model target, e.g. gemini or openrouter:model')
          .setRequired(false),
      ),
  );

function getSubcommand(interaction: ChatInputCommandInteraction): 'status' | 'reset' {
  const maybeOptions = interaction.options as ChatInputCommandInteraction['options'] & {
    getSubcommand?: (required?: boolean) => string | null;
  };
  const subcommand = maybeOptions.getSubcommand?.(false);
  return subcommand === 'reset' ? 'reset' : 'status';
}

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

function hasRuntimeState(target: string): boolean {
  const healthExists = getAllHealth().some((state) => state.target === target);
  const circuitExists = Object.prototype.hasOwnProperty.call(circuitBreaker.getAllStates(), target);
  return healthExists || circuitExists;
}

async function replyDashboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const chunks = splitMessage(formatHealthDashboard(), DISCORD_SAFE_CONTENT_LIMIT);
  const [firstChunk, ...remainingChunks] =
    chunks.length > 0 ? chunks : ['No health data available.'];

  await interaction.reply({
    content: firstChunk,
    ephemeral: true,
  });

  for (const chunk of remainingChunks) {
    await interaction.followUp({
      content: chunk,
      ephemeral: true,
    });
  }
}

async function resetRuntimeHealth(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: 'AI health reset requires Administrator permission.',
      ephemeral: true,
    });
    return;
  }

  const target = interaction.options.getString('target', false);
  const existed = target === null ? true : hasRuntimeState(target);

  resetHealth(target ?? undefined);
  circuitBreaker.reset(target ?? undefined);

  await interaction.reply({
    content: formatHealthResetResult({ target, existed }),
    ephemeral: true,
  });
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  if (getSubcommand(interaction) === 'reset') {
    await resetRuntimeHealth(interaction);
    return;
  }

  await replyDashboard(interaction);
}
