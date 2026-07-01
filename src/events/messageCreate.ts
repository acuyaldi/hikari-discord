import { AttachmentBuilder, Client, Message } from 'discord.js';

import { SPESIFIK_CHANNEL_ID } from '../config/env';
import { splitMessage } from '../utils/splitmessage';
import { generateVoice } from '../services/tts';
import { hasVoiceIntent } from '../services/ttsIntent';
import { checkCooldown } from '../utils/cooldown';
import { chat } from '../services/chat';
import { runMemoryPipeline } from '../services/memory/memoryPipeline';
import { maybeRunSummaryPipeline } from '../services/summary/summaryPipeline';
import {
  getImageAttachmentRejection,
  isSupportedImageAttachment,
} from '../services/imageAnalysis';
import {
  buildMultiUserContext,
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

export function registerMessageCreate(client: Client): void {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const botUser = client.user!;
    const botUserId = botUser.id;
    if (!message.mentions.has(botUser) && message.channel.id !== SPESIFIK_CHANNEL_ID) {
      recordChannelMessage(channelContextFromDiscordMessage(message, botUserId));
      return;
    }

    const userId = message.author.id;
    const channelId = message.channel.id;

    if (checkCooldown(userId)) return;

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
      await message.reply('Halo Senpai! Ada yang bisa Hikari bantu? ✨');
      return;
    }
    if (!promptText && hasImage) promptText = 'Jelaskan gambar ini secara detail dan kreatif.';

    try {
      await message.channel.sendTyping();
      const multiUserContext = await buildMultiUserContext({
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

      const result = await chat({
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
        void maybeRunSummaryPipeline({
          userId,
          guildId: message.guildId,
          messageText: userMessageText,
          // TODO Sprint 3D: pass richer recent in-memory chat history when available.
          recentMessages: [userMessageText],
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

      void runMemoryPipeline(userId, message.guildId, userMessageText);
      void maybeRunSummaryPipeline({
        userId,
        guildId: message.guildId,
        messageText: userMessageText,
        // TODO Sprint 3D: pass richer recent in-memory chat history when available.
        recentMessages: [userMessageText],
      });
    } catch (error) {
      await message.reply('Gomennasai Senpai... Sirkuit otak Hikari sedang korsleting! 🥺💢');
    }
  });
}
