import assert from 'node:assert/strict';
import test from 'node:test';

import { OPENROUTER_MODELS, OPENROUTER_VISION_MODEL } from '../src/config/env';

test('OpenRouter Qwen model slug matches current OpenRouter model id', () => {
  assert.ok(OPENROUTER_MODELS.includes('qwen/qwen-2.5-7b-instruct'));
  assert.equal(
    OPENROUTER_MODELS.some((model) => model.includes('qwen/qwen2.5-7b-instruct')),
    false,
  );
});

test('OpenRouter vision model uses the dedicated Gemma 3 vision-capable default', () => {
  assert.equal(OPENROUTER_VISION_MODEL, 'google/gemma-3-27b-it:free');
});

