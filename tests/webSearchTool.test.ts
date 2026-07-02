import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebSearchTool } from '../src/services/tools/implementations/webSearchTool';

test('webSearchTool.execute returns concise Tavily results for a valid query', async () => {
  const requests: Array<{ url: string; init: { body?: string } }> = [];
  const tool = createWebSearchTool({
    apiKey: 'test-tavily-key',
    maxResults: 2,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init: init as { body?: string } });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          answer: 'A short answer from Tavily.',
          results: [
            {
              title: 'Result One',
              url: 'https://example.com/one',
              content: 'Useful snippet one',
              score: 0.92,
            },
            {
              title: 'Result Two',
              url: 'https://example.com/two',
              content: 'Useful snippet two',
              score: 0.84,
            },
            {
              title: 'Result Three',
              url: 'https://example.com/three',
              content: 'Should be capped out',
              score: 0.5,
            },
          ],
        }),
      };
    },
  });

  const result = await tool.execute({ query: 'latest TypeScript release' });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    query: 'latest TypeScript release',
    answer: 'A short answer from Tavily.',
    results: [
      {
        title: 'Result One',
        url: 'https://example.com/one',
        content: 'Useful snippet one',
        score: 0.92,
      },
      {
        title: 'Result Two',
        url: 'https://example.com/two',
        content: 'Useful snippet two',
        score: 0.84,
      },
    ],
  });
  assert.equal(requests[0].url, 'https://api.tavily.com/search');
  assert.deepEqual(JSON.parse(requests[0].init.body ?? '{}'), {
    api_key: 'test-tavily-key',
    query: 'latest TypeScript release',
    search_depth: 'basic',
    max_results: 2,
  });
});

test('webSearchTool.execute returns failure ToolResult when Tavily returns an error', async () => {
  const tool = createWebSearchTool({
    apiKey: 'test-tavily-key',
    maxResults: 5,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limit exceeded',
    }),
  });

  const result = await tool.execute({ query: 'latest news' });

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /429/);
  assert.match(result.error ?? '', /rate limit/i);
});

test('webSearchTool.execute returns failure ToolResult on timeout or network errors', async () => {
  const tool = createWebSearchTool({
    apiKey: 'test-tavily-key',
    maxResults: 5,
    fetchImpl: async () => {
      throw new Error('network timeout');
    },
  });

  const result = await tool.execute({ query: 'latest news' });

  assert.deepEqual(result, {
    success: false,
    error: 'Tavily search failed: network timeout',
  });
});

