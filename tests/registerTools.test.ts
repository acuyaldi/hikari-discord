import assert from 'node:assert/strict';
import test from 'node:test';

import { registerDefaultTools } from '../src/services/tools/registerTools';
import { clearRegisteredTools, getRegisteredTools } from '../src/services/tools/toolRegistry';

test.afterEach(() => {
  clearRegisteredTools();
});

test('registerDefaultTools does not register web_search when TAVILY_API_KEY is absent', () => {
  registerDefaultTools({ tavilyApiKey: '' });

  assert.deepEqual(
    getRegisteredTools().map((tool) => tool.name),
    ['calculate'],
  );
});

test('registerDefaultTools registers web_search when TAVILY_API_KEY is configured', () => {
  registerDefaultTools({ tavilyApiKey: 'test-tavily-key', webSearchMaxResults: 3 });

  assert.deepEqual(
    getRegisteredTools().map((tool) => tool.name),
    ['calculate', 'web_search'],
  );
});

