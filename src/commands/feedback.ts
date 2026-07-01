import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../types';

export const data = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Kasih aturan atau koreksi baru buat Hikari')
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
    db.prepare('INSERT INTO user_memories (user_id, nickname, feedback_notes) VALUES (?, ?, ?)').run(userId, 'teman', catatanBaru);
  }
  await interaction.reply(
    `🧠 **Catatan baru masuk.** Aku simpan aturan ini:\n> *"${catatanBaru}"*\nSip, mulai chat berikutnya aku ikuti.`,
  );
}
