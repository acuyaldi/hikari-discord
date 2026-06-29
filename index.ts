import { Client, GatewayIntentBits } from 'discord.js';

import type { Command } from './src/types';
import { DISCORD_TOKEN } from './src/config/env';
import { registerEvents } from './src/events';

import * as resetCmd from './src/commands/reset';
import * as setnameCmd from './src/commands/setname';
import * as feedbackCmd from './src/commands/feedback';
import * as drawCmd from './src/commands/draw';
import * as switchCmd from './src/commands/switch';
import * as analyzeCmd from './src/commands/analyze';
import * as statsCmd from './src/commands/stats';
import * as memoryCmd from './src/commands/memory';
import * as rememberCmd from './src/commands/remember';
import * as forgetCmd from './src/commands/forget';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands: Command[] = [
  resetCmd,
  setnameCmd,
  feedbackCmd,
  drawCmd,
  switchCmd,
  analyzeCmd,
  statsCmd,
  memoryCmd,
  rememberCmd,
  forgetCmd,
];

registerEvents(client, commands);

client.login(DISCORD_TOKEN);
