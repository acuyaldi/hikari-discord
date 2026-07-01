import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import {
  clearGlobalProviderOverride,
  clearUserProviderOverride,
  getGlobalProviderOverride,
  getUserProviderOverride,
  resolveProviderOverride,
  setGlobalProviderOverride,
  setUserProviderOverride,
  type ProviderOverrideMode,
  type ProviderOverrideScope,
} from '../services/ai/providerOverride';
import {
  formatProviderOverrideCleared,
  formatProviderOverrideSet,
  formatProviderOverrideStatus,
} from '../services/ai/aiDebugFormatter';

export const data = new SlashCommandBuilder()
  .setName('ai-provider')
  .setDescription('Manage temporary AI provider overrides')
  .addSubcommand((subcommand) =>
    subcommand.setName('status').setDescription('Show current AI provider overrides'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription('Set a temporary AI provider override')
      .addStringOption((option) =>
        option
          .setName('provider')
          .setDescription('Provider override')
          .setRequired(true)
          .addChoices(
            { name: 'auto', value: 'auto' },
            { name: 'gemini', value: 'gemini' },
            { name: 'groq', value: 'groq' },
            { name: 'openrouter', value: 'openrouter' },
            { name: 'huggingface', value: 'huggingface' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('scope')
          .setDescription('Override scope')
          .setRequired(true)
          .addChoices({ name: 'user', value: 'user' }, { name: 'global', value: 'global' }),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clear')
      .setDescription('Clear a temporary AI provider override')
      .addStringOption((option) =>
        option
          .setName('scope')
          .setDescription('Override scope')
          .setRequired(true)
          .addChoices({ name: 'user', value: 'user' }, { name: 'global', value: 'global' }),
      ),
  );

function getSubcommand(interaction: ChatInputCommandInteraction): 'status' | 'set' | 'clear' {
  const subcommand = interaction.options.getSubcommand(true);
  return subcommand === 'set' || subcommand === 'clear' ? subcommand : 'status';
}

function getScope(interaction: ChatInputCommandInteraction): ProviderOverrideScope {
  const scope = interaction.options.getString('scope', true);
  return scope === 'global' ? 'global' : 'user';
}

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

async function rejectGlobalWithoutAdmin(
  interaction: ChatInputCommandInteraction,
  scope: ProviderOverrideScope,
): Promise<boolean> {
  if (scope !== 'global' || isAdmin(interaction)) return false;

  await interaction.reply({
    content: 'Global provider override requires Administrator permission.',
    ephemeral: true,
  });
  return true;
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  const subcommand = getSubcommand(interaction);

  if (subcommand === 'status') {
    await interaction.reply({
      content: formatProviderOverrideStatus({
        globalOverride: getGlobalProviderOverride(),
        userOverride: getUserProviderOverride(interaction.user.id),
        effectiveOverride: resolveProviderOverride(interaction.user.id),
      }),
      ephemeral: true,
    });
    return;
  }

  const scope = getScope(interaction);
  if (await rejectGlobalWithoutAdmin(interaction, scope)) return;

  if (subcommand === 'clear') {
    if (scope === 'global') clearGlobalProviderOverride();
    else clearUserProviderOverride(interaction.user.id);

    await interaction.reply({
      content: formatProviderOverrideCleared(scope),
      ephemeral: true,
    });
    return;
  }

  const provider = interaction.options.getString('provider', true) as ProviderOverrideMode;
  const success =
    scope === 'global'
      ? setGlobalProviderOverride(provider)
      : setUserProviderOverride(interaction.user.id, provider);

  await interaction.reply({
    content: success
      ? formatProviderOverrideSet(scope, provider)
      : `Invalid provider override: ${provider}`,
    ephemeral: true,
  });
}
