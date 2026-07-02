/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

import {
  detectIdentificationIntent,
  identifySource,
} from '../src/services/tools/implementations/sourceIdentification';

const TRIGGER_PHRASES = [
  'ini gambar apa?',
  'ini karakter siapa?',
  'dari mana ini?',
  'cari sumber gambar ini',
  'identify this image',
  'what is this from?',
];

test('detectIdentificationIntent returns true for identification trigger phrases', () => {
  for (const phrase of TRIGGER_PHRASES) {
    assert.equal(detectIdentificationIntent(phrase), true, `expected trigger for: ${phrase}`);
  }
});

test('detectIdentificationIntent returns false for unrelated messages', () => {
  assert.equal(detectIdentificationIntent('tolong jelaskan warna dan komposisi gambar ini'), false);
  assert.equal(detectIdentificationIntent('make this sound like a voice note'), false);
});

test('identifySource returns clean metadata for a confident safe match', async () => {
  const originalGet = axios.get;
  let requestedParams: Record<string, unknown> | undefined;

  (axios as unknown as { get: (url: string, options?: { params?: Record<string, unknown> }) => Promise<{ data: unknown }> }).get = async (_url, options) => {
    requestedParams = options?.params;
    return {
      data: {
        header: { status: 0 },
        results: [
          {
            header: {
              similarity: '86.42',
              index_id: 21,
              thumbnail: 'https://example.com/thumb.jpg',
            },
            data: {
              title: 'Episode 7',
              source: 'Example Anime',
              ext_urls: ['https://example.com/source'],
            },
          },
        ],
      },
    };
  };

  try {
    const result = await identifySource('https://cdn.discordapp.com/image.png', {
      apiKey: 'key',
      confidenceThreshold: 60,
      timeoutMs: 500,
    });

    assert.equal(requestedParams?.output_type, 2);
    assert.equal(requestedParams?.url, 'https://cdn.discordapp.com/image.png');
    assert.equal(requestedParams?.api_key, 'key');
    assert.equal(result.available, true);
    assert.equal(result.match?.title, 'Episode 7');
    assert.equal(result.match?.source, 'Example Anime');
    assert.equal(result.match?.similarity, 86.42);
    assert.equal('thumbnail' in (result.match as object), false);
    assert.equal('url' in (result.match as object), false);
    assert.equal('links' in (result.match as object), false);
  } finally {
    axios.get = originalGet;
  }
});

test('identifySource excludes NSFW-risk database indices even above threshold', async () => {
  const originalGet = axios.get;

  (axios as unknown as { get: () => Promise<{ data: unknown }> }).get = async () => ({
    data: {
      header: { status: 0 },
      results: [
        {
          header: { similarity: '99.9', index_id: 9 },
          data: { title: 'Filtered Booru Result', source: 'Danbooru' },
        },
      ],
    },
  });

  try {
    const result = await identifySource('https://cdn.discordapp.com/image.png', {
      confidenceThreshold: 60,
      timeoutMs: 500,
    });

    assert.equal(result.available, false);
    assert.equal(result.match, undefined);
  } finally {
    axios.get = originalGet;
  }
});

test('identifySource treats below-threshold matches as unavailable', async () => {
  const originalGet = axios.get;

  (axios as unknown as { get: () => Promise<{ data: unknown }> }).get = async () => ({
    data: {
      header: { status: 0 },
      results: [
        {
          header: { similarity: '59.99', index_id: 21 },
          data: { title: 'Weak Match', source: 'Anime' },
        },
      ],
    },
  });

  try {
    const result = await identifySource('https://cdn.discordapp.com/image.png', {
      confidenceThreshold: 60,
      timeoutMs: 500,
    });

    assert.equal(result.available, false);
  } finally {
    axios.get = originalGet;
  }
});

test('identifySource returns unavailable on API errors without throwing', async () => {
  const originalGet = axios.get;

  (axios as unknown as { get: () => Promise<{ data: unknown }> }).get = async () => {
    throw new Error('timeout');
  };

  try {
    const result = await identifySource('https://cdn.discordapp.com/image.png', {
      confidenceThreshold: 60,
      timeoutMs: 500,
    });

    assert.equal(result.available, false);
  } finally {
    axios.get = originalGet;
  }
});
