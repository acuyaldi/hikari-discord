import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../types';

export const data = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('🧠 Ajari/koreksi Hikari secara instan! Hikari akan langsung mengingat aturan baru ini! ✨')
  .addStringOption((option) =>
    option
      .setName('catatan')
      .setDescription("Contoh: 'Jangan pakai kata ara-ara' atau 'Panggil aku Yang Mulia'")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  const userId = interaction.user.id;
  const catatanBaru = interaction.options.getString('catatan', true);
  const userRow = db.prepare('SELECT user_id FROM user_memories WHERE user_id = ?').get(userId);
  if (userRow) {
    db.prepare('UPDATE user_memories SET feedback_notes = ? WHERE user_id = ?').run(catatanBaru, userId);
  } else {
    db.prepare('INSERT INTO user_memories (user_id, nickname, feedback_notes) VALUES (?, ?, ?)').run(userId, 'Senpai', catatanBaru);
  }
  await interaction.reply(
    `🧠 **Sirkuit Pembelajaran Berhasil di-Update!** Hikari sudah mengunci aturan baru dari Senpai:\n> *"${catatanBaru}"*\nHikari akan langsung mematuhinya di chat berikutnya! Sugoi! 🚀✨`,
  );
}
