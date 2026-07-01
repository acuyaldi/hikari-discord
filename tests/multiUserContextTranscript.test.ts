import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearChannelContext,
  getChannelTranscript,
  recordChannelMessage,
} from '../src/services/context/multiUserContext';

test('getChannelTranscript returns the most recent bounded messages in chronological order', () => {
  clearChannelContext('channel-transcript');

  recordChannelMessage({
    id: 'm1',
    channelId: 'channel-transcript',
    authorId: 'alice',
    authorName: 'Alice',
    role: 'user',
    content: 'pesan satu',
  });
  recordChannelMessage({
    id: 'm2',
    channelId: 'channel-transcript',
    authorId: 'bob',
    authorName: 'Bob',
    role: 'user',
    content: 'pesan dua',
  });
  recordChannelMessage({
    id: 'm3',
    channelId: 'channel-transcript',
    authorId: 'hikari',
    authorName: 'Hikari',
    role: 'assistant',
    content: 'pesan tiga',
  });

  const transcript = getChannelTranscript('channel-transcript', 2);

  assert.deepEqual(
    transcript.map((message) => ({ id: message.id, authorName: message.authorName })),
    [
      { id: 'm2', authorName: 'Bob' },
      { id: 'm3', authorName: 'Hikari' },
    ],
  );
});
