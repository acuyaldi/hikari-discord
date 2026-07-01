import { Client, REST, Routes } from 'discord.js';
import { hostname } from 'node:os';
import type { Command } from '../types';

export function registerReady(client: Client, allCommands: Command[]): void {
  client.once('ready', async () => {
    const shardText = client.shard?.ids?.join(',') ?? 'none';
    console.log(
      `[Startup] pid=${process.pid} host=${hostname()} shardIds=${shardText} at=${new Date().toISOString()} commands=${allCommands.length}`,
    );
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
