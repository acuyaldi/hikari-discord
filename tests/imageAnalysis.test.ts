import assert from 'node:assert/strict';
import test from 'node:test';

import db from '../src/database/sqlite';
import { IMAGE_MAX_SIZE_MB } from '../src/config/env';
import { providerManager } from '../src/services/ai/providerManager';
import { setUserProviderOverride, clearUserProviderOverride } from '../src/services/ai/providerOverride';
import { chat } from '../src/services/chat';
import { AIProviderName, TaskType } from '../src/services/ai/types';
import type { AIProvider, ChatRequest, ChatResponse } from '../src/services/ai/types';
import { getImageAttachmentRejection } from '../src/services/imageAnalysis';
import { clearMemory } from '../src/services/chatMemory';
import { CircuitBreaker } from '../src/services/ai/circuitBreaker';

function requestWithImage(): ChatRequest {
  return {
    userId: 'image-user',
    guildId: 'image-guild',
    channelId: 'image-channel',
    promptText: 'what is this?',
    identityPrefix: '',
    finalPrompt: 'what is this?',
    dynamicSystemInstruction: 'system',
    hasImage: true,
    imageUrl: 'https://cdn.discordapp.com/image.png',
    taskType: TaskType.GENERAL,
  };
}

test('text-only chat remains a non-vision request', async () => {
  db.prepare('DELETE FROM user_memories WHERE user_id = ?').run('image-text-user');
  const originalGenerate = providerManager.generate.bind(providerManager);
  const capturedRequests: ChatRequest[] = [];
  providerManager.generate = async (request: ChatRequest): Promise<ChatResponse> => {
    capturedRequests.push(request);
    return { replyText: 'ok', providerUsed: AIProviderName.GEMINI };
  };

  try {
    await chat({
      userId: 'image-text-user',
      guildId: 'image-guild',
      channelId: 'image-channel',
      promptText: 'hello',
      hasImage: false,
    });
  } finally {
    providerManager.generate = originalGenerate;
  }

  assert.equal(capturedRequests.length, 1);
  const request = capturedRequests[0];
  assert.equal(request.hasImage, false);
  assert.notEqual(request.taskType, TaskType.VISION);
});

test('image chat is routed as a vision request', async () => {
  db.prepare('DELETE FROM user_memories WHERE user_id = ?').run('image-chat-user');
  const originalGenerate = providerManager.generate.bind(providerManager);
  const capturedRequests: ChatRequest[] = [];
  providerManager.generate = async (request: ChatRequest): Promise<ChatResponse> => {
    capturedRequests.push(request);
    return { replyText: 'gambar terlihat jelas', providerUsed: AIProviderName.GEMINI };
  };

  try {
    await chat({
      userId: 'image-chat-user',
      guildId: 'image-guild',
      channelId: 'image-channel',
      promptText: 'ini gambar apa?',
      hasImage: true,
      imageUrl: 'https://cdn.discordapp.com/image.png',
    });
  } finally {
    providerManager.generate = originalGenerate;
  }

  assert.equal(capturedRequests.length, 1);
  const request = capturedRequests[0];
  assert.equal(request.hasImage, true);
  assert.equal(request.taskType, TaskType.VISION);
});

test('image identification intent injects a clean grounding hint into the prompt', async () => {
  db.prepare('DELETE FROM user_memories WHERE user_id = ?').run('image-source-user');
  const sourceIdentification =
    require('../src/services/tools/implementations/sourceIdentification') as typeof import('../src/services/tools/implementations/sourceIdentification');
  const originalGenerate = providerManager.generate.bind(providerManager);
  const originalIdentifySource = sourceIdentification.identifySource;
  const capturedRequests: ChatRequest[] = [];
  let identifyCalls = 0;

  sourceIdentification.identifySource = async () => {
    identifyCalls += 1;
    return {
      available: true,
      match: {
        title: 'Episode 7',
        source: 'Example Anime',
        similarity: 86.42,
      },
    };
  };
  providerManager.generate = async (request: ChatRequest): Promise<ChatResponse> => {
    capturedRequests.push(request);
    return { replyText: 'gambar terlihat jelas', providerUsed: AIProviderName.GEMINI };
  };

  try {
    await chat({
      userId: 'image-source-user',
      guildId: 'image-guild',
      channelId: 'image-channel',
      promptText: 'ini karakter siapa?',
      hasImage: true,
      imageUrl: 'https://cdn.discordapp.com/image.png',
    });
  } finally {
    sourceIdentification.identifySource = originalIdentifySource;
    providerManager.generate = originalGenerate;
  }

  assert.equal(identifyCalls, 1);
  assert.equal(capturedRequests.length, 1);
  assert.match(capturedRequests[0].finalPrompt, /Petunjuk identifikasi/i);
  assert.match(capturedRequests[0].finalPrompt, /86\.42%/);
  assert.match(capturedRequests[0].finalPrompt, /Episode 7/);
  assert.match(capturedRequests[0].finalPrompt, /Example Anime/);
  assert.doesNotMatch(capturedRequests[0].finalPrompt, /https?:\/\//i);
});

test('image identification intent with no confident match leaves prompt unchanged', async () => {
  db.prepare('DELETE FROM user_memories WHERE user_id = ?').run('image-no-source-user');
  const sourceIdentification =
    require('../src/services/tools/implementations/sourceIdentification') as typeof import('../src/services/tools/implementations/sourceIdentification');
  const originalGenerate = providerManager.generate.bind(providerManager);
  const originalIdentifySource = sourceIdentification.identifySource;
  const capturedRequests: ChatRequest[] = [];

  sourceIdentification.identifySource = async () => ({ available: false });
  providerManager.generate = async (request: ChatRequest): Promise<ChatResponse> => {
    capturedRequests.push(request);
    return { replyText: 'gambar terlihat jelas', providerUsed: AIProviderName.GEMINI };
  };

  try {
    await chat({
      userId: 'image-no-source-user',
      guildId: 'image-guild',
      channelId: 'image-channel',
      promptText: 'identify this image',
      hasImage: true,
      imageUrl: 'https://cdn.discordapp.com/image.png',
    });
  } finally {
    sourceIdentification.identifySource = originalIdentifySource;
    providerManager.generate = originalGenerate;
  }

  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0].finalPrompt, 'identify this image');
});

test('image without identification intent does not call source identification', async () => {
  db.prepare('DELETE FROM user_memories WHERE user_id = ?').run('image-no-intent-user');
  const sourceIdentification =
    require('../src/services/tools/implementations/sourceIdentification') as typeof import('../src/services/tools/implementations/sourceIdentification');
  const originalGenerate = providerManager.generate.bind(providerManager);
  const originalIdentifySource = sourceIdentification.identifySource;
  let identifyCalls = 0;

  sourceIdentification.identifySource = async () => {
    identifyCalls += 1;
    return { available: false };
  };
  providerManager.generate = async (): Promise<ChatResponse> => ({
    replyText: 'gambar terlihat jelas',
    providerUsed: AIProviderName.GEMINI,
  });

  try {
    await chat({
      userId: 'image-no-intent-user',
      guildId: 'image-guild',
      channelId: 'image-channel',
      promptText: 'jelaskan warna dan komposisi gambar ini',
      hasImage: true,
      imageUrl: 'https://cdn.discordapp.com/image.png',
    });
  } finally {
    sourceIdentification.identifySource = originalIdentifySource;
    providerManager.generate = originalGenerate;
  }

  assert.equal(identifyCalls, 0);
});

test('oversized image attachments are rejected gracefully', () => {
  const rejection = getImageAttachmentRejection({
    contentType: 'image/png',
    size: (IMAGE_MAX_SIZE_MB * 1024 * 1024) + 1,
  });

  assert.match(rejection ?? '', /gambar/i);
  assert.match(rejection ?? '', new RegExp(String(IMAGE_MAX_SIZE_MB)));
});

test('image requests skip non-vision provider overrides and use Gemini', async () => {
  clearUserProviderOverride('image-user');
  setUserProviderOverride('image-user', AIProviderName.GROQ);
  const { ProviderManager } = await import('../src/services/ai/providerManager');
  const manager = new ProviderManager({
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 300_000 }),
  });
  const calls: AIProviderName[] = [];

  const groq: AIProvider = {
    name: AIProviderName.GROQ,
    supportsVision: false,
    supportsReasoning: false,
    supportsCoding: true,
    generate: async () => {
      calls.push(AIProviderName.GROQ);
      return { replyText: 'groq', providerUsed: AIProviderName.GROQ };
    },
  };
  const gemini: AIProvider = {
    name: AIProviderName.GEMINI,
    supportsVision: true,
    supportsReasoning: true,
    supportsCoding: true,
    generate: async () => {
      calls.push(AIProviderName.GEMINI);
      return { replyText: 'vision response', providerUsed: AIProviderName.GEMINI };
    },
  };

  manager.registerProvider(groq);
  manager.registerProvider(gemini);

  try {
    const response = await manager.generate(requestWithImage());

    assert.equal(response.providerUsed, AIProviderName.GEMINI);
    assert.deepEqual(calls, [AIProviderName.GEMINI]);
  } finally {
    clearUserProviderOverride('image-user');
  }
});

test('GeminiProvider passes image inlineData with the text prompt', async () => {
  clearMemory('gemini-image-channel');
  const chatMemory = require('../src/services/chatMemory') as typeof import('../src/services/chatMemory');
  const downloadImage = require('../src/utils/downloadImage') as typeof import('../src/utils/downloadImage');
  const originalGetGeminiChat = chatMemory.getGeminiChat;
  const originalDownload = downloadImage.downloadDiscordImage;
  let capturedMessage: unknown;

  chatMemory.getGeminiChat = () => ({
    sendMessage: async ({ message }: { message: unknown }) => {
      capturedMessage = message;
      return { text: 'gambar berisi kucing' };
    },
  });
  downloadImage.downloadDiscordImage = async () => ({
    data: 'base64-image',
    mimeType: 'image/png',
  });

  try {
    const { GeminiProvider } = await import('../src/services/ai/providers/geminiProvider');
    const response = await new GeminiProvider().generate({
      ...requestWithImage(),
      channelId: 'gemini-image-channel',
      finalPrompt: 'Analyze this image.',
      dynamicSystemInstruction: 'system',
    });

    assert.equal(response.replyText, 'gambar berisi kucing');
    assert.deepEqual(capturedMessage, [
      'Analyze this image.',
      { inlineData: { data: 'base64-image', mimeType: 'image/png' } },
    ]);
  } finally {
    chatMemory.getGeminiChat = originalGetGeminiChat;
    downloadImage.downloadDiscordImage = originalDownload;
    clearMemory('gemini-image-channel');
  }
});

test('GeminiProvider falls back to text-only when image download fails', async () => {
  clearMemory('gemini-download-fail-channel');
  const chatMemory = require('../src/services/chatMemory') as typeof import('../src/services/chatMemory');
  const downloadImage = require('../src/utils/downloadImage') as typeof import('../src/utils/downloadImage');
  const originalGetGeminiChat = chatMemory.getGeminiChat;
  const originalDownload = downloadImage.downloadDiscordImage;
  let capturedMessage: unknown;

  chatMemory.getGeminiChat = () => ({
    sendMessage: async ({ message }: { message: unknown }) => {
      capturedMessage = message;
      return { text: 'maaf, aku jawab dari teksnya saja' };
    },
  });
  downloadImage.downloadDiscordImage = async () => {
    throw new Error('download failed');
  };

  try {
    const { GeminiProvider } = await import('../src/services/ai/providers/geminiProvider');
    const response = await new GeminiProvider().generate({
      ...requestWithImage(),
      channelId: 'gemini-download-fail-channel',
      finalPrompt: 'Analyze this image.',
      dynamicSystemInstruction: 'system',
    });

    assert.equal(response.replyText, 'maaf, aku jawab dari teksnya saja');
    assert.equal(typeof capturedMessage, 'string');
    assert.match(capturedMessage as string, /gambar gagal diproses/i);
  } finally {
    chatMemory.getGeminiChat = originalGetGeminiChat;
    downloadImage.downloadDiscordImage = originalDownload;
    clearMemory('gemini-download-fail-channel');
  }
});
