import { Client } from 'discord.js';
import db from '../database/sqlite';
import type { Command } from '../types';

export function registerInteractionCreate(client: Client, allCommands: Command[]): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = allCommands.find((c) => c.data.name === interaction.commandName);
    if (!cmd) return;
    await cmd.execute(interaction, { db });
  });
}
