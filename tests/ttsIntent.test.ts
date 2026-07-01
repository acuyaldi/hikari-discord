import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttachmentBuilder } from 'discord.js';

import { DEFAULT_TTS_TRIGGER_KEYWORDS } from '../src/config/env';
import { hasVoiceIntent } from '../src/services/ttsIntent';
import { sendReplyWithOptionalVoice } from '../src/events/messageCreate';

interface ReplyPayload {
  content: string;
  files?: AttachmentBuilder[];
}

function createReplyHarness() {
  const replies: Array<string | ReplyPayload> = [];
  const sends: string[] = [];

  return {
    replies,
    sends,
    reply: async (payload: string | ReplyPayload) => {
      replies.push(payload);
    },
    send: async (payload: string) => {
      sends.push(payload);
    },
  };
}

test('messages without voice intent skip TTS generation', async () => {
  const harness = createReplyHarness();
  let ttsCalls = 0;

  await sendReplyWithOptionalVoice({
    userMessageText: 'halo hikari, apa kabar?',
    replyText: 'Aku baik.',
    engineIndicator: '',
    reply: harness.reply,
    send: harness.send,
    generateVoice: async () => {
      ttsCalls += 1;
      return {} as AttachmentBuilder;
    },
  });

  assert.equal(ttsCalls, 0);
  assert.equal(harness.replies[0], 'Aku baik.\n');
});

test('messages with each configured voice keyword generate TTS', async () => {
  for (const keyword of DEFAULT_TTS_TRIGGER_KEYWORDS) {
    const harness = createReplyHarness();
    let ttsCalls = 0;
    const attachment = {} as AttachmentBuilder;

    await sendReplyWithOptionalVoice({
      userMessageText: `Hikari, ${keyword} dong`,
      replyText: 'Baik.',
      engineIndicator: '',
      reply: harness.reply,
      send: harness.send,
      generateVoice: async () => {
        ttsCalls += 1;
        return attachment;
      },
    });

    assert.equal(ttsCalls, 1, `expected TTS for keyword: ${keyword}`);
    assert.deepEqual(harness.replies[0], { content: 'Baik.\n', files: [attachment] });
  }
});

test('TTS generation failure still sends text reply', async () => {
  const harness = createReplyHarness();

  await sendReplyWithOptionalVoice({
    userMessageText: 'reply with voice please',
    replyText: 'Tetap terkirim.',
    engineIndicator: '',
    reply: harness.reply,
    send: harness.send,
    generateVoice: async () => {
      throw new Error('tts failed');
    },
  });

  assert.equal(harness.replies[0], 'Tetap terkirim.\n');
});

test('detector errors fall back to no TTS', async () => {
  const harness = createReplyHarness();
  let ttsCalls = 0;

  await sendReplyWithOptionalVoice({
    userMessageText: 'reply with voice please',
    replyText: 'Text only.',
    engineIndicator: '',
    reply: harness.reply,
    send: harness.send,
    detectVoiceIntent: () => {
      throw new Error('detector failed');
    },
    generateVoice: async () => {
      ttsCalls += 1;
      return {} as AttachmentBuilder;
    },
  });

  assert.equal(ttsCalls, 0);
  assert.equal(harness.replies[0], 'Text only.\n');
});

test('voice intent detector matches keywords case-insensitively', () => {
  assert.equal(hasVoiceIntent('Hikari, VOICE NOTE ya'), true);
  assert.equal(hasVoiceIntent('tolong jawab biasa saja'), false);
});
