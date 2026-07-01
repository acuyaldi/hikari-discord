import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatInputCommandInteraction } from 'discord.js';

import { execute as executeHealth } from '../src/commands/health';
import { CircuitBreaker, circuitBreaker } from '../src/services/ai/circuitBreaker';
import { getHealth, recordHealthFailure, resetHealth } from '../src/services/ai/healthCache';
import type { CommandContext } from '../src/types';

interface MockReply {
  content: string;
  ephemeral: boolean;
}

function transientError(status = 429): Error & { status: number } {
  const err = new Error(`status ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

function mockInteraction(options: {
  subcommand?: 'status' | 'reset';
  target?: string | null;
  isAdmin?: boolean;
}): { interaction: ChatInputCommandInteraction; replies: MockReply[] } {
  const replies: MockReply[] = [];
  const interaction = {
    memberPermissions: options.isAdmin ? { has: () => true } : { has: () => false },
    options: {
      getSubcommand: () => options.subcommand ?? 'status',
      getString: (name: string) => (name === 'target' ? options.target ?? null : null),
    },
    reply: async (reply: MockReply) => {
      replies.push(reply);
    },
    followUp: async (reply: MockReply) => {
      replies.push(reply);
    },
  } as unknown as ChatInputCommandInteraction;

  return { interaction, replies };
}

const commandContext = {} as CommandContext;

test('health reset requires admin permission', async () => {
  const { interaction, replies } = mockInteraction({ subcommand: 'reset', isAdmin: false });

  await executeHealth(interaction, commandContext);

  assert.match(replies[0].content, /requires Administrator/);
  assert.equal(replies[0].ephemeral, true);
});

test('health reset target clears health and circuit state', async () => {
  resetHealth();
  circuitBreaker.recordFailure('gemini', transientError(429));
  circuitBreaker.recordFailure('gemini', transientError(429));
  circuitBreaker.recordFailure('gemini', transientError(429));
  recordHealthFailure('gemini', transientError(429), true);
  const { interaction, replies } = mockInteraction({
    subcommand: 'reset',
    target: 'gemini',
    isAdmin: true,
  });

  await executeHealth(interaction, commandContext);

  assert.match(replies[0].content, /AI health state reset for `gemini`/);
  assert.equal(getHealth('gemini').status, 'unknown');
  assert.equal(circuitBreaker.getState('gemini').failureCount, 0);
});

test('health reset all clears all health and circuit state', async () => {
  resetHealth();
  circuitBreaker.recordFailure('groq', transientError(429));
  circuitBreaker.recordFailure('groq', transientError(429));
  circuitBreaker.recordFailure('groq', transientError(429));
  recordHealthFailure('groq', transientError(429), true);
  const { interaction, replies } = mockInteraction({ subcommand: 'reset', isAdmin: true });

  await executeHealth(interaction, commandContext);

  assert.match(replies[0].content, /AI health state reset for all targets/);
  assert.equal(getHealth('groq').status, 'unknown');
  assert.equal(circuitBreaker.getState('groq').failureCount, 0);
});
