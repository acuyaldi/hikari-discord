import { AttachmentBuilder, Client, Message } from 'discord.js';

import {
  SPESIFIK_CHANNEL_ID,
  SUMMARY_MAX_INPUT_MESSAGES,
} from '../config/env';
import { splitMessage } from '../utils/splitmessage';
import { generateVoice } from '../services/tts';
import { hasVoiceIntent } from '../services/ttsIntent';
import { checkCooldown } from '../utils/cooldown';
import { chat } from '../services/chat';
import { runMemoryPipeline } from '../services/memory/memoryPipeline';
import { logSummary } from '../services/summary/summaryDebug';
import { maybeRunSummaryPipeline } from '../services/summary/summaryPipeline';
import {
  getImageAttachmentRejection,
  isSupportedImageAttachment,
} from '../services/imageAnalysis';
import {
  buildMultiUserContext,
  getChannelTranscript,
  recordChannelMessage,
  type ChannelContextMessage,
  type MentionContextUser,
} from '../services/context/multiUserContext';

interface ReplyWithOptionalVoiceOptions {
  userMessageText: string;
  replyText: string;
  engineIndicator: string;
  reply: (payload: string | { content: string; files: AttachmentBuilder[] }) => Promise<unknown>;
  send: (payload: string) => Promise<unknown>;
  detectVoiceIntent?: (messageText: string) => boolean;
  generateVoice?: (text: string) => Promise<AttachmentBuilder | null>;
}

interface RegisterMessageCreateDependencies {
  checkCooldown?: typeof checkCooldown;
  chat?: typeof chat;
  runMemoryPipeline?: typeof runMemoryPipeline;
  maybeRunSummaryPipeline?: typeof maybeRunSummaryPipeline;
  buildMultiUserContext?: typeof buildMultiUserContext;
  getChannelTranscript?: typeof getChannelTranscript;
}

interface BuildSummaryRecentMessagesOptions {
  maxInputMessages?: number;
  getTranscript?: typeof getChannelTranscript;
  logSummary?: typeof logSummary;
}
const MESSAGE_DEDUPE_TTL_MS = 30_000;
const REQUEST_FINGERPRINT_TTL_MS = 12_000;

function normalizeMessageContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildRequestFingerprint(options: {
  userId: string;
  channelId: string;
  normalizedPromptText: string;
  imageUrl?: string;
}): string {
  return [
    options.userId,
    options.channelId,
    options.normalizedPromptText,
    options.imageUrl ?? '-',
  ].join('|');
}

export async function sendReplyWithOptionalVoice({
  userMessageText,
  replyText,
  engineIndicator,
  reply,
  send,
  detectVoiceIntent = hasVoiceIntent,
  generateVoice: generateVoiceAttachment = generateVoice,
}: ReplyWithOptionalVoiceOptions): Promise<void> {
  const finalReplyWithIndicator = replyText + engineIndicator;
  const textChunks = splitMessage(finalReplyWithIndicator);

  let shouldGenerateVoice = false;
  try {
    shouldGenerateVoice = detectVoiceIntent(userMessageText);
  } catch {
    shouldGenerateVoice = false;
  }

  let voiceAttachment: AttachmentBuilder | null = null;
  if (shouldGenerateVoice) {
    try {
      voiceAttachment = await generateVoiceAttachment(replyText);
    } catch {
      voiceAttachment = null;
    }
  }

  await reply(
    voiceAttachment ? { content: textChunks[0], files: [voiceAttachment] } : textChunks[0],
  );
  for (let i = 1; i < textChunks.length; i++) {
    await send(textChunks[i]);
  }
}

function displayNameForMessage(message: Message): string {
  return message.member?.displayName ?? message.author.globalName ?? message.author.username;
}

function channelContextFromDiscordMessage(
  message: Message,
  botUserId: string,
): ChannelContextMessage {
  return {
    id: message.id,
    channelId: message.channel.id,
    authorId: message.author.id,
    authorName: displayNameForMessage(message),
    role: message.author.id === botUserId ? 'assistant' : 'user',
    content: message.content,
    createdTimestamp: message.createdTimestamp,
  };
}

function mentionedUsersForContext(message: Message, botUserId: string): MentionContextUser[] {
  return Array.from(message.mentions.users.values())
    .filter((user) => user.id !== botUserId)
    .map((user) => ({
      id: user.id,
      name: message.mentions.members?.get(user.id)?.displayName ?? user.globalName ?? user.username,
    }));
}

function summaryMessageLabel(message: Pick<ChannelContextMessage, 'authorName' | 'role'>): string {
  const authorName = message.authorName.trim();
  if (authorName.length > 0) return `@${authorName}`;
  return message.role === 'assistant' ? '@Assistant' : '@User';
}

export function buildSummaryRecentMessages(
  channelId: string,
  userMessageText: string,
  options: BuildSummaryRecentMessagesOptions = {},
): string[] {
  const getTranscript = options.getTranscript ?? getChannelTranscript;
  const writeSummaryLog = options.logSummary ?? logSummary;
  try {
    const transcript = getTranscript(
      channelId,
      options.maxInputMessages ?? SUMMARY_MAX_INPUT_MESSAGES,
    )
      .map((message) => `${summaryMessageLabel(message)}: ${message.content.trim()}`)
      .filter((message) => message.trim().length > 0);

    const recentMessages = transcript.length > 0 ? transcript : [userMessageText];
    writeSummaryLog('Summary Pipeline Input', `recentMessages count: ${recentMessages.length}`);
    return recentMessages;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeSummaryLog(
      'Summary Pipeline Input',
      `recentMessages fallback count: 1 reason=${reason}`,
    );
    return [userMessageText];
  }
}

export function registerMessageCreate(
  client: Client,
  dependencies: RegisterMessageCreateDependencies = {},
): void {
  const cooldownCheck = dependencies.checkCooldown ?? checkCooldown;
  const runChat = dependencies.chat ?? chat;
  const runSummaryPipeline = dependencies.maybeRunSummaryPipeline ?? maybeRunSummaryPipeline;
  const runMemory = dependencies.runMemoryPipeline ?? runMemoryPipeline;
  const buildContext = dependencies.buildMultiUserContext ?? buildMultiUserContext;
  const getTranscript = dependencies.getChannelTranscript ?? getChannelTranscript;
  const processedMessageIds = new Set<string>();
  const inFlightRequestFingerprints = new Set<string>();
  const recentRequestFingerprints = new Map<string, number>();

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (processedMessageIds.has(message.id)) return;
    processedMessageIds.add(message.id);
    setTimeout(() => processedMessageIds.delete(message.id), MESSAGE_DEDUPE_TTL_MS);

    const botUser = client.user!;
    const botUserId = botUser.id;
    if (!message.mentions.has(botUser) && message.channel.id !== SPESIFIK_CHANNEL_ID) {
      recordChannelMessage(channelContextFromDiscordMessage(message, botUserId));
      return;
    }

    const userId = message.author.id;
    const channelId = message.channel.id;

    if (cooldownCheck(userId)) return;

    let promptText = message.content
      .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
      .trim();
    const userMessageText = promptText;
    const imageAttachmentCandidate = Array.from(message.attachments.values()).find((attachment) =>
      (attachment.contentType ?? '').toLowerCase().startsWith('image/'),
    );
    const imageRejection = imageAttachmentCandidate
      ? getImageAttachmentRejection(imageAttachmentCandidate)
      : null;

    if (imageRejection) {
      await message.reply(imageRejection);
      return;
    }

    const imageAttachment =
      imageAttachmentCandidate && isSupportedImageAttachment(imageAttachmentCandidate)
        ? imageAttachmentCandidate
        : undefined;
    const hasImage = imageAttachment !== undefined;

    if (!promptText && !hasImage) {
      await message.reply('Hai. Lempar aja yang mau dibantu. Aku lagi cukup waras buat mikir.');
      return;
    }
    if (!promptText && hasImage) promptText = 'Jelaskan gambar ini secara detail dan kreatif.';

    const requestFingerprint = buildRequestFingerprint({
      userId,
      channelId,
      normalizedPromptText: normalizeMessageContent(promptText),
      imageUrl: imageAttachment?.url,
    });

    if (inFlightRequestFingerprints.has(requestFingerprint)) return;

    const lastProcessedAt = recentRequestFingerprints.get(requestFingerprint);
    if (
      lastProcessedAt !== undefined &&
      Date.now() - lastProcessedAt <= REQUEST_FINGERPRINT_TTL_MS
    ) {
      return;
    }

    inFlightRequestFingerprints.add(requestFingerprint);

    try {
      await message.channel.sendTyping();
      const multiUserContext = await buildContext({
        channelId,
        messageId: message.id,
        authorId: message.author.id,
        authorName: displayNameForMessage(message),
        content: promptText,
        botUserId,
        mentions: mentionedUsersForContext(message, botUserId),
        hasReference: message.reference !== null,
        fetchReference: async () =>
          channelContextFromDiscordMessage(await message.fetchReference(), botUserId),
      });
      recordChannelMessage({
        ...channelContextFromDiscordMessage(message, botUserId),
        content: promptText,
      });

      const result = await runChat({
        userId,
        guildId: message.guildId,
        channelId,
        promptText,
        hasImage,
        imageUrl: imageAttachment?.url,
        recentMessages: multiUserContext.recentMessages,
        currentUserMessage: multiUserContext.currentUserMessage,
      });

      if (result.earlyReply) {
        await message.reply(result.earlyReply);
        recordChannelMessage({
          id: `hikari:${message.id}:early`,
          channelId,
          authorId: botUserId,
          authorName: botUser.username,
          role: 'assistant',
          content: result.earlyReply,
        });
        void runSummaryPipeline({
          userId,
          guildId: message.guildId,
          messageText: userMessageText,
          recentMessages: buildSummaryRecentMessages(channelId, userMessageText, {
            getTranscript,
          }),
        });
        return;
      }

      await sendReplyWithOptionalVoice({
        userMessageText,
        replyText: result.replyText,
        engineIndicator: result.engineIndicator,
        reply: (payload) => message.reply(payload),
        send: (payload) => message.channel.send(payload),
      });
      recordChannelMessage({
        id: `hikari:${message.id}:reply`,
        channelId,
        authorId: botUserId,
        authorName: botUser.username,
        role: 'assistant',
        content: result.replyText,
      });

      void runMemory(userId, message.guildId, userMessageText);
      void runSummaryPipeline({
        userId,
        guildId: message.guildId,
        messageText: userMessageText,
        recentMessages: buildSummaryRecentMessages(channelId, userMessageText, {
          getTranscript,
        }),
      });
    } catch (error) {
      await message.reply('Yah, aku lagi error sebentar. Mesin pikirnya batuk kecil. Coba kirim lagi pesanmu.');
    } finally {
      inFlightRequestFingerprints.delete(requestFingerprint);
      recentRequestFingerprints.set(requestFingerprint, Date.now());
      setTimeout(
        () => recentRequestFingerprints.delete(requestFingerprint),
        REQUEST_FINGERPRINT_TTL_MS,
      );
    }
  });
}
