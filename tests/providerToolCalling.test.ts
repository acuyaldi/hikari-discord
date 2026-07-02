import assert from 'node:assert/strict';
import test from 'node:test';

import ai from '../src/ai/gemini';
import groq from '../src/ai/groq';
import { GeminiProvider } from '../src/services/ai/providers/geminiProvider';
import { GroqProvider } from '../src/services/ai/providers/groqProvider';
import { TaskType } from '../src/services/ai/types';
import type { ChatRequest } from '../src/services/ai/types';
import { clearMemory } from '../src/services/chatMemory';
import { clearRegisteredTools, registerTool } from '../src/services/tools/toolRegistry';
import type { ToolDefinition } from '../src/services/tools/types';

const calculateTool: ToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression.',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string' },
    },
    required: ['expression'],
  },
  execute: async (args: unknown) => {
    const expression = typeof args === 'object' && args !== null && 'expression' in args
      ? (args as { expression?: unknown }).expression
      : undefined;
    return {
      success: true,
      data: expression === '2 + 2' ? '4' : 'unknown',
    };
  },
};

function request(channelId: string): ChatRequest {
  return {
    userId: 'provider-tool-user',
    guildId: 'provider-tool-guild',
    channelId,
    promptText: 'berapa 2 + 2?',
    identityPrefix: '',
    finalPrompt: 'berapa 2 + 2?',
    dynamicSystemInstruction: 'system',
    hasImage: false,
    taskType: TaskType.GENERAL,
    tools: [calculateTool],
  };
}

test.afterEach(() => {
  clearRegisteredTools();
  clearMemory('gemini-tool-channel');
  clearMemory('gemini-tool-sync-fail-channel');
  clearMemory('gemini-search-context-channel');
  clearMemory('groq-tool-channel');
});

test('GeminiProvider runs calculator tool calls and syncs the final reply into chat history', async () => {
  clearRegisteredTools();
  registerTool(calculateTool);

  const originalGenerateContent = ai.models.generateContent;
  const originalChatsCreate = ai.chats.create;
  const generatedStates: unknown[] = [];
  const chatHistory: unknown[] = [];

  (ai.models as unknown as { generateContent: (params: unknown) => Promise<unknown> }).generateContent = async (params: unknown) => {
    generatedStates.push(params);
    if (generatedStates.length === 1) {
      return {
        text: null,
        functionCalls: [
          {
            id: 'call-1',
            name: 'calculate',
            args: { expression: '2 + 2' },
          },
        ],
      };
    }

    return { text: '2 + 2 = 4' };
  };

  ai.chats.create = () => ({
    history: chatHistory,
  }) as never;

  try {
    const response = await new GeminiProvider().generate(request('gemini-tool-channel'));

    assert.equal(response.replyText, '2 + 2 = 4');
    assert.equal(generatedStates.length, 2);
    assert.deepEqual(chatHistory, [
      { role: 'user', parts: [{ text: 'berapa 2 + 2?' }] },
      { role: 'model', parts: [{ text: '2 + 2 = 4' }] },
    ]);
  } finally {
    ai.models.generateContent = originalGenerateContent;
    ai.chats.create = originalChatsCreate;
  }
});

test('GeminiProvider does not block a tool reply when chat history sync fails', async () => {
  clearRegisteredTools();
  registerTool(calculateTool);

  const originalGenerateContent = ai.models.generateContent;
  const originalChatsCreate = ai.chats.create;
  let callCount = 0;

  (ai.models as unknown as { generateContent: () => Promise<unknown> }).generateContent = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        text: null,
        functionCalls: [
          {
            id: 'call-1',
            name: 'calculate',
            args: { expression: '2 + 2' },
          },
        ],
      };
    }

    return { text: '2 + 2 = 4' };
  };

  ai.chats.create = () => ({
    history: {
      push: () => {
        throw new Error('history sync failed');
      },
    },
  }) as never;

  try {
    const response = await new GeminiProvider().generate(request('gemini-tool-sync-fail-channel'));

    assert.equal(response.replyText, '2 + 2 = 4');
  } finally {
    ai.models.generateContent = originalGenerateContent;
    ai.chats.create = originalChatsCreate;
  }
});

test('GeminiProvider keeps full prompt context when native search grounding is used', async () => {
  const originalGenerateContent = ai.models.generateContent;
  const originalChatsCreate = ai.chats.create;
  const sentMessages: unknown[] = [];

  (ai.models as unknown as { generateContent: (params: unknown) => Promise<unknown> }).generateContent = async () => ({
    text: 'Search grounding says the relevant update happened today.',
  });

  ai.chats.create = () => ({
    sendMessage: async (params: unknown) => {
      sentMessages.push(params);
      return { text: 'final grounded answer' };
    },
  }) as never;

  try {
    const response = await new GeminiProvider().generate({
      userId: 'search-user',
      guildId: 'search-guild',
      channelId: 'gemini-search-context-channel',
      promptText: 'apa berita terbaru TypeScript?',
      identityPrefix: '[INFO USER: panggil dia Aldi]\n\n',
      finalPrompt: [
        '[RECENT CONTEXT: user asked about TypeScript yesterday]',
        '[MEMORY: user prefers concise answers]',
        'CURRENT USER MESSAGE: apa berita terbaru TypeScript?',
      ].join('\n'),
      dynamicSystemInstruction: 'SYSTEM PERSONA: Hikari witty persona\nSUMMARY: prior discussion',
      hasImage: false,
      taskType: TaskType.SEARCH,
    });

    assert.equal(response.replyText, 'final grounded answer');
    assert.equal(sentMessages.length, 1);
    const message = (sentMessages[0] as { message?: string }).message ?? '';
    assert.match(message, /RECENT CONTEXT/);
    assert.match(message, /MEMORY: user prefers concise answers/);
    assert.match(message, /CURRENT USER MESSAGE/);
    assert.match(message, /Search grounding says/);
  } finally {
    ai.models.generateContent = originalGenerateContent;
    ai.chats.create = originalChatsCreate;
  }
});

test('GroqProvider runs calculator tool calls and returns the final answer', async () => {
  clearRegisteredTools();
  registerTool(calculateTool);

  const originalCreate = groq.chat.completions.create;
  const calls: unknown[] = [];

  (groq.chat.completions as unknown as { create: (params: unknown) => Promise<unknown> }).create = async (params: unknown) => {
    calls.push(params);
    if (calls.length === 1) {
      return {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'calculate',
                    arguments: '{"expression":"2 + 2"}',
                  },
                },
              ],
            },
          },
        ],
      };
    }

    return {
      choices: [
        {
          message: {
            content: '2 + 2 = 4',
          },
        },
      ],
    };
  };

  try {
    const response = await new GroqProvider().generate(request('groq-tool-channel'));

    assert.equal(response.replyText, '2 + 2 = 4');
    assert.equal(calls.length, 2);
  } finally {
    groq.chat.completions.create = originalCreate;
  }
});
