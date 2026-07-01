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
    channelId: 'channel-1',
    guildId: 'guild-1',
    createdTimestamp: Date.now(),
    user: { id: userId },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    reply: async (payload: string | InteractionReplyOptions) => {
      interaction.replied = true;
      replies.push(payload);
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (payload: string | InteractionReplyOptions) => {
      replies.push(payload);
    },
    followUp: async (payload: string | InteractionReplyOptions) => {
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
  let sawDeferred = false;
  const harness = createClientHarness();
  registerInteractionCreate(harness.client as never, [
    {
      data: {
        name: 'draw',
        toJSON: () => ({ name: 'draw' }),
      },
      execute: async (interaction) => {
        sawDeferred = interaction.deferred;
        drawCalls += 1;
      },
    },
  ]);

  await harness.dispatch(createInteraction('draw', 'user-one').interaction);
  await harness.dispatch(createInteraction('draw', 'user-two').interaction);

  assert.equal(drawCalls, 2);
  assert.equal(sawDeferred, true);
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

test('command execution failures are swallowed and fall back to an error reply', async () => {
  clearCooldowns();
  const harness = createClientHarness();
  const { interaction, replies } = createInteraction('reset', 'user-reset');

  registerInteractionCreate(harness.client as never, [
    {
      data: {
        name: 'reset',
        toJSON: () => ({ name: 'reset' }),
      },
      execute: async () => {
        throw new Error('database offline');
      },
    },
  ]);

  await assert.doesNotReject(async () => {
    await harness.dispatch(interaction);
  });

  assert.equal(replies.length, 1);
  assert.match(String((replies[0] as InteractionReplyOptions).content ?? replies[0]), /gagal|gomennasai/i);
});

test('interaction reply failures do not escape the interaction handler', async () => {
  clearCooldowns();
  const harness = createClientHarness();
  const { interaction } = createInteraction('reset', 'user-reset');
  interaction.reply = async () => {
    throw Object.assign(new Error('Unknown interaction'), { code: 10062, status: 404 });
  };

  registerInteractionCreate(harness.client as never, [
    {
      data: {
        name: 'reset',
        toJSON: () => ({ name: 'reset' }),
      },
      execute: async (currentInteraction) => {
        await currentInteraction.reply('done');
      },
    },
  ]);

  await assert.doesNotReject(async () => {
    await harness.dispatch(interaction);
  });
});

test('unknown interaction errors do not trigger an additional fallback reply attempt', async () => {
  clearCooldowns();
  const harness = createClientHarness();
  const { interaction, replies } = createInteraction('analyze', 'user-analyze');

  registerInteractionCreate(harness.client as never, [
    {
      data: {
        name: 'analyze',
        toJSON: () => ({ name: 'analyze' }),
      },
      execute: async () => {
        throw Object.assign(new Error('Unknown interaction'), { code: 10062, status: 404 });
      },
    },
  ]);

  await assert.doesNotReject(async () => {
    await harness.dispatch(interaction);
  });

  assert.equal(replies.length, 0);
});

test('AI command defer failures log interaction age details before exiting', async () => {
  clearCooldowns();
  const originalNow = Date.now;
  Date.now = () => 10_000;

  const harness = createClientHarness();
  const { interaction } = createInteraction('analyze', 'user-analyze');
  const deferAges: string[] = [];
  (interaction as unknown as { createdTimestamp: number }).createdTimestamp = 6_500;
  interaction.deferReply = async () => {
    throw Object.assign(new Error('Unknown interaction'), { code: 10062, status: 404 });
  };

  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    deferAges.push(args.map(String).join(' '));
  };

  registerInteractionCreate(harness.client as never, [
    createCommand('analyze', () => {
      throw new Error('should not execute');
    }),
  ]);

  try {
    await assert.doesNotReject(async () => {
      await harness.dispatch(interaction);
    });
  } finally {
    console.error = originalError;
    Date.now = originalNow;
  }

  assert.match(deferAges.join('\n'), /ageMs=3500/);
  assert.match(deferAges.join('\n'), /channel=channel-1/);
  assert.match(deferAges.join('\n'), /guild=guild-1/);
});

test('fallback switches to editReply when reply says interaction was already acknowledged', async () => {
  clearCooldowns();
  const harness = createClientHarness();
  const { interaction, replies } = createInteraction('analyze', 'user-analyze');
  interaction.reply = async () => {
    throw Object.assign(new Error('Interaction has already been acknowledged.'), {
      code: 40060,
      status: 400,
    });
  };
  (interaction as unknown as {
    editReply: (payload: string | InteractionReplyOptions) => Promise<void>;
  }).editReply = async (payload: string | InteractionReplyOptions) => {
    replies.push(payload);
  };

  registerInteractionCreate(harness.client as never, [
    {
      data: {
        name: 'analyze',
        toJSON: () => ({ name: 'analyze' }),
      },
      execute: async (currentInteraction) => {
        await currentInteraction.reply('first ack');
      },
    },
  ]);

  await assert.doesNotReject(async () => {
    await harness.dispatch(interaction);
  });

  assert.equal(replies.length, 1);
  assert.match(String((replies[0] as InteractionReplyOptions).content ?? replies[0]), /gagal|gomennasai/i);
});
