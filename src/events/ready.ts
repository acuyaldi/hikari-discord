import { Client, REST, Routes } from 'discord.js';
import type { Command } from '../types';

export function registerReady(client: Client, allCommands: Command[]): void {
  client.once('ready', async () => {
    console.log('🤖 Hikari siap dipakai.');
    const rest = new REST({ version: '10' }).setToken(client.token!);
    try {
      await rest.put(Routes.applicationCommands(client.user!.id), {
        body: allCommands.map((cmd) => cmd.data.toJSON()),
      });
      console.log('✅ Semua Slash commands sukses terdaftar!');
    } catch (error) {
      console.error(error);
    }
  });
}
