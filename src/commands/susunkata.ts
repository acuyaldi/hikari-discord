import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { SUSUNKATA_MAX_ROUNDS } from '../config/env';
import type { CommandContext } from '../types';
import {
  createRoom,
  destroyRoom,
  getRoom,
  trackRoomMessage,
} from '../services/games/susunkata/roomManager';
import {
  createSusunKataLobbyComponents,
  createSusunKataLobbyEmbed,
} from '../services/games/susunkata/buttonHandlers';

const DEFAULT_ROUNDS = 5;

export const data = new SlashCommandBuilder()
  .setName('susunkata')
  .setDescription('Mainkan Susun Kata cepat-cepatan di channel ini')
  .addIntegerOption((option) =>
    option
      .setName('rounds')
      .setDescription(`Jumlah ronde (default ${DEFAULT_ROUNDS}, maksimal ${SUSUNKATA_MAX_ROUNDS})`)
      .setRequired(false)
      .setMinValue(1),
  )
  .addBooleanOption((option) =>
    option
      .setName('force_clear')
      .setDescription('Bersihkan room Susun Kata yang tersangkut di channel ini')
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: 'Susun Kata cuma bisa dimainkan di server.', ephemeral: true });
    return;
  }

  if (interaction.options.getBoolean('force_clear') ?? false) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'Butuh izin Manage Server untuk membersihkan room Susun Kata secara paksa.',
        ephemeral: true,
      });
      return;
    }

    const hadRoom = Boolean(getRoom(interaction.channelId));
    destroyRoom(interaction.channelId);
    await interaction.reply({
      content: hadRoom
        ? 'Room Susun Kata di channel ini sudah dibersihkan.'
        : 'Tidak ada room Susun Kata aktif di channel ini.',
      ephemeral: true,
    });
    return;
  }

  const requestedRounds = interaction.options.getInteger('rounds') ?? DEFAULT_ROUNDS;
  const rounds = Math.max(1, Math.min(requestedRounds, SUSUNKATA_MAX_ROUNDS));

  try {
    const room = createRoom(interaction.channelId, interaction.user.id, rounds, {
      guildId: interaction.guildId,
    });

    await interaction.reply({
      content: requestedRounds > SUSUNKATA_MAX_ROUNDS
        ? `Jumlah ronde dikunci ke maksimal ${SUSUNKATA_MAX_ROUNDS}.`
        : undefined,
      embeds: [
        createSusunKataLobbyEmbed({
          creatorId: room.creatorId,
          playerIds: Array.from(room.players),
          rounds: room.rounds,
        }),
      ],
      components: createSusunKataLobbyComponents(interaction.channelId),
    });

    const lobbyMessage = await interaction.fetchReply().catch(() => null);
    trackRoomMessage(interaction.channelId, lobbyMessage?.id);
  } catch {
    await interaction.reply({
      content: 'Masih ada room Susun Kata aktif di channel ini. Selesaikan atau batalkan dulu ya.',
      ephemeral: true,
    });
  }
}
