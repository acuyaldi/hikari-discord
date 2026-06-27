import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../types';

export const data = new SlashCommandBuilder()
  .setName('setname')
  .setDescription('Beri tahu Hikari nama panggilan kesukaanmu 🥰')
  .addStringOption((option) =>
    option.setName('nama').setDescription('Masukkan nama panggilan').setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  const userId = interaction.user.id;
  const inputName = interaction.options.getString('nama', true);
  const userRow = db.prepare('SELECT user_id FROM user_memories WHERE user_id = ?').get(userId);
  if (userRow) {
    db.prepare('UPDATE user_memories SET nickname = ? WHERE user_id = ?').run(inputName, userId);
  } else {
    db.prepare('INSERT INTO user_memories (user_id, nickname, feedback_notes) VALUES (?, ?, ?)').run(userId, inputName, '');
  }
  await interaction.reply(`🌸 **Uwooo!** Mulai sekarang Hikari akan memanggilmu **"${inputName}"**! ✨🥰`);
}
