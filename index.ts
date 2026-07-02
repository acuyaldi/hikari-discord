import { Client, GatewayIntentBits } from 'discord.js';

import type { Command } from './src/types';
import { DISCORD_TOKEN } from './src/config/env';
import { registerEvents } from './src/events';
import { registerDefaultTools } from './src/services/tools/registerTools';

import * as resetCmd from './src/commands/reset';
import * as setnameCmd from './src/commands/setname';
import * as feedbackCmd from './src/commands/feedback';
import * as drawCmd from './src/commands/draw';
import * as switchCmd from './src/commands/switch';
import * as analyzeCmd from './src/commands/analyze';
import * as healthCmd from './src/commands/health';
import * as debugAiCmd from './src/commands/debugAi';
import * as aiProviderCmd from './src/commands/aiProvider';
import * as memoryCmd from './src/commands/memory';
import * as rememberCmd from './src/commands/remember';
import * as forgetCmd from './src/commands/forget';
import * as werewolfCmd from './src/commands/werewolf';
import * as triviaCmd from './src/commands/trivia';
import * as triviaLeaderboardCmd from './src/commands/triviaLeaderboard';
import * as susunkataCmd from './src/commands/susunkata';

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
  healthCmd,
  debugAiCmd,
  aiProviderCmd,
  memoryCmd,
  rememberCmd,
  forgetCmd,
  werewolfCmd,
  triviaCmd,
  triviaLeaderboardCmd,
  susunkataCmd,
];

registerDefaultTools();
registerEvents(client, commands);

client.login(DISCORD_TOKEN);
