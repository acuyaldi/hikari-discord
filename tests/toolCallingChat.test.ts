import assert from 'node:assert/strict';
import test from 'node:test';

import db from '../src/database/sqlite';
import { TOOL_CALLING_ENABLED } from '../src/config/env';
import { providerManager } from '../src/services/ai/providerManager';
import { AIProviderName } from '../src/services/ai/types';
import type { ChatRequest, ChatResponse } from '../src/services/ai/types';
import { chat } from '../src/services/chat';
import { clearRegisteredTools, registerTool } from '../src/services/tools/toolRegistry';
import type { ToolDefinition } from '../src/services/tools/types';

const mockTool: ToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression.',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string' },
    },
    required: ['expression'],
  },
  execute: async () => ({ success: true, data: '4' }),
};

test('TOOL_CALLING_ENABLED defaults to true', () => {
  assert.equal(TOOL_CALLING_ENABLED, true);
});

test('chat attaches registered tools to provider requests when tool calling is enabled', async () => {
  clearRegisteredTools();
  registerTool(mockTool);
  db.prepare('DELETE FROM user_memories WHERE user_id = ?').run('tool-chat-user');

  const originalGenerate = providerManager.generate.bind(providerManager);
  let capturedRequest: ChatRequest | null = null;
  providerManager.generate = async (request: ChatRequest): Promise<ChatResponse> => {
    capturedRequest = request;
    return {
      replyText: '2 + 2 = 4',
      providerUsed: AIProviderName.GEMINI,
    };
  };

  try {
    const result = await chat({
      userId: 'tool-chat-user',
      guildId: 'tool-chat-guild',
      channelId: 'tool-chat-channel',
      promptText: 'berapa 2 + 2?',
      hasImage: false,
    });

    assert.equal(result.replyText, '2 + 2 = 4');
  } finally {
    providerManager.generate = originalGenerate;
    clearRegisteredTools();
  }

  const request = capturedRequest as ChatRequest | null;
  assert.notEqual(request, null);
  assert.deepEqual(request?.tools?.map((tool: ToolDefinition) => tool.name), ['calculate']);
});
