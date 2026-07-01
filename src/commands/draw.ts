import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import axios from 'axios';
import type { CommandContext, UserRow } from '../types';

export const data = new SlashCommandBuilder()
  .setName('draw')
  .setDescription('Bikin gambar dari idemu')
  .addStringOption((option) =>
    option.setName('prompt').setDescription('Deskripsikan gambar').setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  const userId = interaction.user.id;
  const userRow = db
    .prepare('SELECT nickname FROM user_memories WHERE user_id = ?')
    .get(userId) as Pick<UserRow, 'nickname'> | undefined;
  const panggilan = userRow?.nickname ?? 'teman';
  const userPrompt = interaction.options.getString('prompt', true);

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply();
  }
  try {
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/p/${encodeURIComponent(userPrompt)}?width=1024&height=1024&seed=${seed}&nofeed=true`;
    const imageResponse = await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer' });
    const imageAttachment = new AttachmentBuilder(Buffer.from(imageResponse.data), { name: 'hikari-art.png' });
    await interaction.editReply({
      content: `🎨 **Beres.** Ini gambar buat **${panggilan}**.\n> *Prompt: "${userPrompt}"*`,
      files: [imageAttachment],
    });
  } catch {
    await interaction.editReply(`Yah **${panggilan}**, generator gambarnya lagi ngambek. Coba ulang lagi.`);
  }
}
