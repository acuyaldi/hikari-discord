import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';
import {
  cancelWerewolfGame,
  forceResetWerewolfGame,
  forceWerewolfVoting,
  startWerewolfRegistration,
} from '../services/werewolf/game';

export const data = new SlashCommandBuilder()
  .setName('werewolf')
  .setDescription('Jalankan game Werewolf di server ini')
  .addSubcommand((subcommand) =>
    subcommand.setName('start').setDescription('Buka lobby Werewolf baru'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('vote').setDescription('Paksa mulai fase voting'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('stop').setDescription('Batalkan game Werewolf aktif'),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('reset').setDescription('Reset paksa game Werewolf aktif (Manage Server)'),
  );

function getSubcommand(interaction: ChatInputCommandInteraction): 'start' | 'vote' | 'stop' | 'reset' {
  const subcommand = interaction.options.getSubcommand(true);
  return subcommand === 'vote' || subcommand === 'stop' || subcommand === 'reset'
    ? subcommand
    : 'start';
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  const subcommand = getSubcommand(interaction);

  if (subcommand === 'vote') {
    await forceWerewolfVoting(interaction, db);
    return;
  }

  if (subcommand === 'stop') {
    await cancelWerewolfGame(interaction, db);
    return;
  }

  if (subcommand === 'reset') {
    await forceResetWerewolfGame(interaction, db);
    return;
  }

  await startWerewolfRegistration(interaction, db);
}
