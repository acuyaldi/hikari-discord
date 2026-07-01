import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../types';

interface TriviaScoreRow {
  user_id: string;
  points: number;
}

export const data = new SlashCommandBuilder()
  .setName('trivia-leaderboard')
  .setDescription('Lihat peringkat trivia untuk server ini');

function rankEmoji(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '🔹';
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Leaderboard trivia hanya tersedia di server.',
      ephemeral: true,
    });
    return;
  }

  try {
    const rows = db
      .prepare(
        `SELECT user_id, points
         FROM trivia_scores
         WHERE guild_id = ?
         ORDER BY points DESC
         LIMIT 10`,
      )
      .all(interaction.guildId) as TriviaScoreRow[];

    if (rows.length === 0) {
      await interaction.reply('Belum ada skor trivia di server ini. Mulai pakai /trivia dulu!');
      return;
    }

    const description = rows
      .map((row, index) => `${rankEmoji(index + 1)} **#${index + 1}** <@${row.user_id}> — **${row.points}** poin`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏆 Trivia Leaderboard')
      .setDescription(description)
      .setFooter({ text: `Total pemain terdaftar: ${rows.length}` });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[Trivia] leaderboard query failed:', error);
    await interaction.reply({
      content: 'Gagal memuat leaderboard trivia. Coba lagi sebentar.',
      ephemeral: true,
    });
  }
}
