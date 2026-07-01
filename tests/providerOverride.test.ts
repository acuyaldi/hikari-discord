import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatInputCommandInteraction } from 'discord.js';

import { CircuitBreaker } from '../src/services/ai/circuitBreaker';
import { execute as executeAiProvider } from '../src/commands/aiProvider';
import {
  clearGlobalProviderOverride,
  clearUserProviderOverride,
  getAllProviderOverrides,
  resolveProviderOverride,
  setGlobalProviderOverride,
  setUserProviderOverride,
} from '../src/services/ai/providerOverride';
import { resetHealth } from '../src/services/ai/healthCache';
import type { AIProvider, ChatRequest } from '../src/services/ai/types';
import { AIProviderName, TaskType } from '../src/services/ai/types';
import type { CommandContext } from '../src/types';
import {
  formatProviderOverrideCleared,
  formatProviderOverrideSet,
  formatProviderOverrideStatus,
} from '../src/services/ai/aiDebugFormatter';

function resetOverrides(): void {
  clearGlobalProviderOverride();
  for (const userId of Object.keys(getAllProviderOverrides().users)) {
    clearUserProviderOverride(userId);
  }
}

function request(userId = 'user-1'): ChatRequest {
  return {
    userId,
    guildId: 'guild-1',
    channelId: 'channel-1',
    promptText: 'hello',
    identityPrefix: '',
    finalPrompt: 'hello',
    dynamicSystemInstruction: 'system',
    hasImage: false,
    taskType: TaskType.GENERAL,
  };
}

function transientError(status = 429): Error & { status: number } {
  const err = new Error(`status ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

function provider(name: AIProviderName, calls: AIProviderName[]): AIProvider {
  return {
    name,
    supportsVision: true,
    supportsReasoning: true,
    supportsCoding: true,
    generate: async () => {
      calls.push(name);
      return { replyText: name, providerUsed: name };
    },
  };
}

interface MockReply {
  content: string;
  ephemeral: boolean;
}

function mockInteraction(options: {
  subcommand: 'status' | 'set' | 'clear';
  provider?: string;
  scope?: string;
  isAdmin?: boolean;
}): { interaction: ChatInputCommandInteraction; replies: MockReply[] } {
  const replies: MockReply[] = [];
  const interaction = {
    user: { id: 'user-1' },
    memberPermissions: options.isAdmin
      ? { has: () => true }
      : { has: () => false },
    options: {
      getSubcommand: () => options.subcommand,
      getString: (name: string) => {
        if (name === 'provider') return options.provider ?? null;
        if (name === 'scope') return options.scope ?? null;
        return null;
      },
    },
    reply: async (reply: MockReply) => {
      replies.push(reply);
    },
  } as unknown as ChatInputCommandInteraction;

  return { interaction, replies };
}

const commandContext = {} as CommandContext;

test('user override has priority over global override', () => {
  resetOverrides();

  assert.equal(setGlobalProviderOverride(AIProviderName.GEMINI), true);
  assert.equal(setUserProviderOverride('user-1', AIProviderName.GROQ), true);

  assert.equal(resolveProviderOverride('user-1'), AIProviderName.GROQ);
  assert.equal(resolveProviderOverride('user-2'), AIProviderName.GEMINI);
});

test('auto means no forced provider', () => {
  resetOverrides();

  assert.equal(setGlobalProviderOverride('auto'), true);
  assert.equal(setUserProviderOverride('user-1', 'auto'), true);

  assert.equal(resolveProviderOverride('user-1'), 'auto');
  assert.equal(resolveProviderOverride('user-2'), 'auto');
});

test('invalid provider names are rejected safely', () => {
  resetOverrides();

  assert.equal(setGlobalProviderOverride('not-real'), false);
  assert.equal(setUserProviderOverride('user-1', 'nope'), false);

  assert.equal(resolveProviderOverride('user-1'), 'auto');
});

test('forced provider is tried first and excluded from fallback duplicates', async () => {
  resetOverrides();
  resetHealth();
  const { ProviderManager } = await import('../src/services/ai/providerManager');
  const calls: AIProviderName[] = [];
  const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 300_000 });

  setUserProviderOverride('user-1', AIProviderName.GROQ);

  const manager = new ProviderManager({ circuitBreaker: breaker });
  manager.registerProvider({
    ...provider(AIProviderName.GROQ, calls),
    generate: async () => {
      calls.push(AIProviderName.GROQ);
      throw new Error('groq failed');
    },
  });
  manager.registerProvider(provider(AIProviderName.GEMINI, calls));
  manager.registerProvider(provider(AIProviderName.OPENROUTER, calls));

  const response = await manager.generate(request('user-1'));

  assert.equal(response.providerUsed, AIProviderName.GEMINI);
  assert.deepEqual(calls, [AIProviderName.GROQ, AIProviderName.GEMINI]);
});

test('forced provider in cooldown is skipped and fallback remains available', async () => {
  resetOverrides();
  resetHealth();
  const { ProviderManager } = await import('../src/services/ai/providerManager');
  const calls: AIProviderName[] = [];
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000 });

  setUserProviderOverride('user-1', AIProviderName.GROQ);
  breaker.recordFailure(AIProviderName.GROQ, transientError(429));

  const manager = new ProviderManager({ circuitBreaker: breaker });
  manager.registerProvider(provider(AIProviderName.GROQ, calls));
  manager.registerProvider(provider(AIProviderName.GEMINI, calls));

  const response = await manager.generate(request('user-1'));

  assert.equal(response.providerUsed, AIProviderName.GEMINI);
  assert.deepEqual(calls, [AIProviderName.GEMINI]);
});

test('provider override formatter output is readable', () => {
  const status = formatProviderOverrideStatus({
    globalOverride: AIProviderName.GROQ,
    userOverride: AIProviderName.OPENROUTER,
    effectiveOverride: AIProviderName.OPENROUTER,
  });

  assert.match(status, /AI Provider Override/);
  assert.match(status, /Global Override: groq/);
  assert.match(status, /Your Override: openrouter/);
  assert.match(status, /Effective Override: openrouter/);
  assert.match(formatProviderOverrideSet('user', AIProviderName.GEMINI), /User override set to gemini/);
  assert.match(formatProviderOverrideCleared('global'), /Global override cleared/);
});

test('ai-provider command rejects global changes without admin and allows user set', async () => {
  resetOverrides();
  const denied = mockInteraction({
    subcommand: 'set',
    provider: AIProviderName.GROQ,
    scope: 'global',
    isAdmin: false,
  });

  await executeAiProvider(denied.interaction, commandContext);

  assert.match(denied.replies[0].content, /requires Administrator/);
  assert.equal(resolveProviderOverride('user-1'), 'auto');

  const userSet = mockInteraction({
    subcommand: 'set',
    provider: AIProviderName.GROQ,
    scope: 'user',
    isAdmin: false,
  });

  await executeAiProvider(userSet.interaction, commandContext);

  assert.match(userSet.replies[0].content, /User override set to groq/);
  assert.equal(resolveProviderOverride('user-1'), AIProviderName.GROQ);
});
