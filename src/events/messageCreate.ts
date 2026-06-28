import { Client } from 'discord.js';

import { SPESIFIK_CHANNEL_ID } from '../config/env';
import { splitMessage } from '../utils/splitmessage';
import { generateVoice } from '../services/tts';
import { checkCooldown } from '../utils/cooldown';
import { chat } from '../services/chat';
import { runMemoryPipeline } from '../services/memory/memoryPipeline';

export function registerMessageCreate(client: Client): void {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.mentions.has(client.user!) && message.channel.id !== SPESIFIK_CHANNEL_ID) return;

    const userId = message.author.id;
    const channelId = message.channel.id;

    if (checkCooldown(userId)) return;

    let promptText = message.content.replace(`<@${client.user!.id}>`, '').trim();
    const userMessageText = promptText;
    const firstAttachment = message.attachments.first();
    const hasImage = message.attachments.size > 0 && (firstAttachment?.contentType?.startsWith('image/') ?? false);

    if (!promptText && !hasImage) {
      await message.reply('Halo Senpai! Ada yang bisa Hikari bantu? ✨');
      return;
    }
    if (!promptText && hasImage) promptText = 'Jelaskan gambar ini secara detail dan kreatif.';

    try {
      await message.channel.sendTyping();

      const result = await chat({
        userId,
        guildId: message.guildId,
        channelId,
        promptText,
        hasImage,
        imageUrl: firstAttachment?.url,
      });

      if (result.earlyReply) {
        await message.reply(result.earlyReply);
        return;
      }

      const finalReplyWithIndicator = result.replyText + result.engineIndicator;
      const voiceAttachment = await generateVoice(result.replyText);

      const textChunks = splitMessage(finalReplyWithIndicator);
      await message.reply(
        voiceAttachment ? { content: textChunks[0], files: [voiceAttachment] } : textChunks[0],
      );
      for (let i = 1; i < textChunks.length; i++) {
        await message.channel.send(textChunks[i]);
      }

      void runMemoryPipeline(userId, message.guildId, userMessageText);
    } catch (error) {
      await message.reply('Gomennasai Senpai... Sirkuit otak Hikari sedang korsleting! 🥺💢');
    }
  });
}
