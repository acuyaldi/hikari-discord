import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { CommandContext } from '../types';

export const data = new SlashCommandBuilder()
  .setName('switch')
  .setDescription('Pilih engine Hikari')
  .addStringOption((o) =>
    o
      .setName('engine')
      .setDescription('Pilih engine AI yang ingin digunakan')
      .setRequired(true)
      .addChoices(
        { name: 'Auto (Pilih Cerdas)', value: 'auto' },
        { name: 'Gemini (Default)', value: 'gemini' },
        { name: 'Groq (Cepat)', value: 'groq' },
        { name: 'OpenRouter (Kreatif)', value: 'openrouter' },
        { name: 'Hugging Face (Backup Gratis)', value: 'huggingface' },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  { db }: CommandContext,
): Promise<void> {
  const userId = interaction.user.id;
  const engine = interaction.options.getString('engine', true);
  const userRow = db.prepare('SELECT user_id FROM user_memories WHERE user_id = ?').get(userId);
  if (userRow) {
    db.prepare('UPDATE user_memories SET engine_pref = ? WHERE user_id = ?').run(engine, userId);
  } else {
    db.prepare('INSERT INTO user_memories (user_id, nickname, engine_pref) VALUES (?, ?, ?)').run(userId, 'teman', engine);
  }
  await interaction.reply(`Sip. Sekarang aku pakai engine **${engine.toUpperCase()}**.`);
}
