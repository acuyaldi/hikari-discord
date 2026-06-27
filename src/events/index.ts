import { Client } from 'discord.js';
import type { Command } from '../types';

import { registerReady } from './ready';
import { registerInteractionCreate } from './interactionCreate';
import { registerMessageCreate } from './messageCreate';

export function registerEvents(client: Client, commands: Command[]): void {
  registerReady(client, commands);
  registerInteractionCreate(client, commands);
  registerMessageCreate(client);
}
