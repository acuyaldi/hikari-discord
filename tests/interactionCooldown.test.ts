import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatInputCommandInteraction, InteractionReplyOptions } from 'discord.js';

import { registerInteractionCreate } from '../src/events/interactionCreate';
import { clearCooldowns } from '../src/utils/cooldown';
import type { Command } from '../src/types';

type InteractionHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

function createClientHarness() {
  let handler: InteractionHandler | null = null;
  const client = {
    on: (event: string, registeredHandler: InteractionHandler) => {
      assert.equal(event, 'interactionCreate');
      handler = registeredHandler;
    },
  };

  return {
    client,
    dispatch: async (interaction: ChatInputCommandInteraction) => {
      assert.notEqual(handler, null);
      await handler!(interaction);
    },
  };
}

function createInteraction(commandName: string, userId: string) {
  const replies: Array<string | InteractionReplyOptions> = [];
  const interaction = {
    commandName,
    user: { id: userId },
    isChatInputCommand: () => true,
    reply: async (payload: string | InteractionReplyOptions) => {
      replies.push(payload);
    },
  } as unknown as ChatInputCommandInteraction;

  return { interaction, replies };
}

function createCommand(name: string, onExecute: () => void): Command {
  return {
    data: {
      name,
      toJSON: () => ({ name }),
    },
    execute: async () => {
      onExecute();
    },
  };
}

test('AI slash commands share the per-user cooldown', async () => {
  clearCooldowns();
  let analyzeCalls = 0;
  const harness = createClientHarness();
  registerInteractionCreate(harness.client as never, [
    createCommand('analyze', () => {
      analyzeCalls += 1;
    }),
  ]);

  const first = createInteraction('analyze', 'user-ai');
  const second = createInteraction('analyze', 'user-ai');

  await harness.dispatch(first.interaction);
  await harness.dispatch(second.interaction);

  assert.equal(analyzeCalls, 1);
  assert.equal(second.replies.length, 1);
  assert.match(String((second.replies[0] as InteractionReplyOptions).content), /sebentar/i);
});

test('AI slash cooldown is per-user', async () => {
  clearCooldowns();
  let drawCalls = 0;
  const harness = createClientHarness();
  registerInteractionCreate(harness.client as never, [
    createCommand('draw', () => {
      drawCalls += 1;
    }),
  ]);

  await harness.dispatch(createInteraction('draw', 'user-one').interaction);
  await harness.dispatch(createInteraction('draw', 'user-two').interaction);

  assert.equal(drawCalls, 2);
});

test('non-AI slash commands are not gated by the AI cooldown', async () => {
  clearCooldowns();
  let memoryCalls = 0;
  const harness = createClientHarness();
  registerInteractionCreate(harness.client as never, [
    createCommand('memory', () => {
      memoryCalls += 1;
    }),
  ]);

  await harness.dispatch(createInteraction('memory', 'user-memory').interaction);
  await harness.dispatch(createInteraction('memory', 'user-memory').interaction);

  assert.equal(memoryCalls, 2);
});
