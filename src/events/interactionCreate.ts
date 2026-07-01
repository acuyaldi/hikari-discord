import { Client } from 'discord.js';
import db from '../database/sqlite';
import { checkCooldown } from '../utils/cooldown';
import type { Command } from '../types';

const AI_COOLDOWN_COMMANDS = new Set(['analyze', 'draw']);
const COOLDOWN_REPLY = 'Sebentar ya Senpai, Hikari masih memproses permintaanmu yang sebelumnya.';

export function registerInteractionCreate(client: Client, allCommands: Command[]): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = allCommands.find((c) => c.data.name === interaction.commandName);
    if (!cmd) return;
    if (AI_COOLDOWN_COMMANDS.has(interaction.commandName) && checkCooldown(interaction.user.id)) {
      await interaction.reply({ content: COOLDOWN_REPLY, ephemeral: true });
      return;
    }
    await cmd.execute(interaction, { db });
  });
}
