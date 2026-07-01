import {
  DEBUG_CONTEXT,
  DEBUG_SUMMARY,
  MENTION_CONTEXT_LOOKBACK,
  SUMMARY_MAX_CONTEXT_LENGTH,
} from '../../config/env';
import type { ChatMessage } from './contextBuilder';

export interface ChannelContextMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  role: 'user' | 'assistant';
  content: string;
  createdTimestamp?: number;
}

export interface MentionContextUser {
  id: string;
  name: string;
}

export interface BuildMultiUserContextInput {
  channelId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  content: string;
  botUserId: string;
  mentions: MentionContextUser[];
  hasReference: boolean;
  fetchReference?: () => Promise<ChannelContextMessage | null>;
  mentionLookback?: number;
  maxContextLength?: number;
}

export interface MentionResolution {
  name: string;
  found: boolean;
}

export interface MultiUserContextResult {
  recentMessages: ChatMessage[];
  currentUserMessage: string;
  replyDetected: boolean;
  replyAuthorName: string | null;
  mentionsDetected: string[];
  mentionResolution: MentionResolution[];
}

const channelHistory = new Map<string, ChannelContextMessage[]>();
const MAX_STORED_MESSAGES_PER_CHANNEL = 100;

function cleanContent(content: string): string {
  return content.trim();
}

function toChatMessage(message: ChannelContextMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    authorName: message.authorName,
    content: cleanContent(message.content),
  };
}

function debugMultiUserContext(result: MultiUserContextResult): void {
  if (!DEBUG_SUMMARY && !DEBUG_CONTEXT) return;

  console.log(
    [
      '[Multi-User Context]',
      `reply detected: ${result.replyDetected}`,
      `reply author: ${result.replyAuthorName ?? '-'}`,
      `mentions detected: ${result.mentionsDetected.join(', ') || '-'}`,
      `mention resolution: ${
        result.mentionResolution
          .map((mention) => `${mention.name}:${mention.found ? 'success' : 'failure'}`)
          .join(', ') || '-'
      }`,
      `final recentMessages author list: ${
        result.recentMessages.map((message) => message.authorName ?? message.role).join(', ') || '-'
      }`,
    ].join('\n'),
  );
}

export function clearChannelContext(channelId?: string): void {
  if (channelId) {
    channelHistory.delete(channelId);
    return;
  }
  channelHistory.clear();
}

export function recordChannelMessage(message: ChannelContextMessage): void {
  const content = cleanContent(message.content);
  if (content.length === 0) return;

  const history = channelHistory.get(message.channelId) ?? [];
  const existingIndex = history.findIndex((item) => item.id === message.id);
  const normalized = { ...message, content };

  if (existingIndex >= 0) {
    history[existingIndex] = normalized;
  } else {
    history.push(normalized);
  }

  if (history.length > MAX_STORED_MESSAGES_PER_CHANNEL) {
    history.splice(0, history.length - MAX_STORED_MESSAGES_PER_CHANNEL);
  }

  channelHistory.set(message.channelId, history);
}

function recentChannelMessages(channelId: string, excludeId: string): ChannelContextMessage[] {
  return (channelHistory.get(channelId) ?? []).filter((message) => message.id !== excludeId);
}

function findMentionedMessage(
  channelId: string,
  mention: MentionContextUser,
  lookback: number,
): ChannelContextMessage | null {
  const recent = recentChannelMessages(channelId, '').slice(-Math.max(0, lookback));
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    if (message.authorId === mention.id) return message;
  }
  return null;
}

function includeMessage(
  messages: ChatMessage[],
  ids: Set<string>,
  message: ChatMessage,
): void {
  if (message.id && ids.has(message.id)) return;
  if (message.id) ids.add(message.id);
  messages.push(message);
}

function trimToContextLength(messages: ChatMessage[], maxLength: number): ChatMessage[] {
  if (!Number.isFinite(maxLength) || maxLength <= 0) return [];

  const selected: ChatMessage[] = [];
  let length = 0;
  for (const message of messages) {
    const nextLength = length + message.content.length;
    if (nextLength > maxLength) continue;
    selected.push(message);
    length = nextLength;
  }
  return selected;
}

export async function buildMultiUserContext(
  input: BuildMultiUserContextInput,
): Promise<MultiUserContextResult> {
  const mentionLookback = input.mentionLookback ?? MENTION_CONTEXT_LOOKBACK;
  const maxContextLength = input.maxContextLength ?? SUMMARY_MAX_CONTEXT_LENGTH;
  const explicitMessages: ChatMessage[] = [];
  const includedIds = new Set<string>();
  let replyAuthorName: string | null = null;

  if (input.hasReference && input.fetchReference) {
    try {
      const referenced = await input.fetchReference();
      if (referenced && referenced.channelId === input.channelId) {
        replyAuthorName = referenced.authorName;
        includeMessage(explicitMessages, includedIds, {
          id: `reply:${referenced.id}`,
          role: referenced.role,
          authorName: referenced.authorName,
          content: `[Reply to @${referenced.authorName}]: ${cleanContent(referenced.content)}`,
        });
      }
    } catch {
      replyAuthorName = null;
    }
  }

  const mentionResolution: MentionResolution[] = [];
  for (const mention of input.mentions.filter((mention) => mention.id !== input.botUserId)) {
    const mentionedMessage = findMentionedMessage(input.channelId, mention, mentionLookback);
    mentionResolution.push({ name: mention.name, found: mentionedMessage !== null });
    if (!mentionedMessage) continue;

    includeMessage(explicitMessages, includedIds, {
      id: `mention:${mentionedMessage.id}`,
      role: mentionedMessage.role,
      authorName: mentionedMessage.authorName,
      content: `[Mentioned: @${mention.name}]: ${cleanContent(mentionedMessage.content)}`,
    });
  }

  const recentMessages = recentChannelMessages(input.channelId, input.messageId)
    .map(toChatMessage)
    .filter((message) => !(message.id && includedIds.has(message.id)));
  const boundedRecent = trimToContextLength(
    [...explicitMessages, ...recentMessages],
    maxContextLength,
  );
  const result: MultiUserContextResult = {
    recentMessages: boundedRecent,
    currentUserMessage: `@${input.authorName}: ${cleanContent(input.content)}`,
    replyDetected: input.hasReference,
    replyAuthorName,
    mentionsDetected: input.mentions
      .filter((mention) => mention.id !== input.botUserId)
      .map((mention) => mention.name),
    mentionResolution,
  };

  debugMultiUserContext(result);
  return result;
}
