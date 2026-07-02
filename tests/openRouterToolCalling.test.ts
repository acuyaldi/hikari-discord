import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenRouterProvider } from '../src/services/ai/providers/openrouterProvider';
import { TaskType } from '../src/services/ai/types';
import type { ChatRequest } from '../src/services/ai/types';
import { createWebSearchTool } from '../src/services/tools/implementations/webSearchTool';
import { clearRegisteredTools, registerTool } from '../src/services/tools/toolRegistry';
import type { ToolDefinition } from '../src/services/tools/types';

function request(tools: ToolDefinition[]): ChatRequest {
  return {
    userId: 'tool-user',
    guildId: 'tool-guild',
    channelId: 'tool-channel',
    promptText: 'berapa 2 + 2?',
    identityPrefix: '',
    finalPrompt: 'berapa 2 + 2?',
    dynamicSystemInstruction: 'system',
    hasImage: false,
    taskType: TaskType.GENERAL,
    tools,
  };
}

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

test.afterEach(() => {
  clearRegisteredTools();
});

test('OpenRouterProvider runs a calculator tool call and returns the final answer', async () => {
  clearRegisteredTools();
  registerTool(calculateTool);
  const calls: Array<{ tools?: unknown; messages: unknown[] }> = [];
  const provider = new OpenRouterProvider({
    apiKey: 'test-key',
    models: ['model-a'],
    client: {
      chat: {
        completions: {
          create: async (params) => {
            calls.push({ tools: params.tools, messages: params.messages });
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
          },
        },
      },
    },
  });

  const response = await provider.generate(request([calculateTool]));

  assert.equal(response.replyText, '2 + 2 = 4');
  assert.equal(calls.length, 2);
  assert.ok(Array.isArray(calls[0].tools));
  const toolMessage = calls[1].messages[calls[1].messages.length - 1] as { role?: string; content?: string };
  assert.equal(toolMessage.role, 'tool');
  assert.match(toolMessage.content ?? '', /"data":"4"/);
});

test('OpenRouterProvider falls back to normal chat when tool calling fails before a final answer', async () => {
  clearRegisteredTools();
  registerTool(calculateTool);
  let callCount = 0;
  const provider = new OpenRouterProvider({
    apiKey: 'test-key',
    models: ['model-a'],
    client: {
      chat: {
        completions: {
          create: async (params) => {
            callCount += 1;
            if (params.tools) throw new Error('tool path failed');
            return {
              choices: [
                {
                  message: {
                    content: 'normal answer',
                  },
                },
              ],
            };
          },
        },
      },
    },
  });

  const response = await provider.generate(request([calculateTool]));

  assert.equal(response.replyText, 'normal answer');
  assert.equal(callCount, 2);
});

test('OpenRouterProvider runs web_search and incorporates search results into final reply', async () => {
  clearRegisteredTools();
  const webSearchTool = createWebSearchTool({
    apiKey: 'test-tavily-key',
    maxResults: 1,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: 'Current Weather',
            url: 'https://example.com/weather',
            content: 'The current weather is clear.',
            score: 0.91,
          },
        ],
      }),
    }),
  });
  registerTool(webSearchTool);

  const messagesByCall: unknown[][] = [];
  const provider = new OpenRouterProvider({
    apiKey: 'test-key',
    models: ['model-a'],
    client: {
      chat: {
        completions: {
          create: async (params) => {
            messagesByCall.push(params.messages);
            if (messagesByCall.length === 1) {
              return {
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: 'call-search',
                          type: 'function',
                          function: {
                            name: 'web_search',
                            arguments: '{"query":"weather today"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            }

            const toolMessage = params.messages[params.messages.length - 1] as { content?: string };
            assert.match(toolMessage.content ?? '', /https:\/\/example\.com\/weather/);
            assert.match(toolMessage.content ?? '', /The current weather is clear/);

            return {
              choices: [
                {
                  message: {
                    content: 'Search says the current weather is clear.',
                  },
                },
              ],
            };
          },
        },
      },
    },
  });

  const response = await provider.generate({
    ...request([webSearchTool]),
    promptText: 'what is the weather today?',
    finalPrompt: 'what is the weather today?',
  });

  assert.equal(response.replyText, 'Search says the current weather is clear.');
  assert.equal(messagesByCall.length, 2);
});
