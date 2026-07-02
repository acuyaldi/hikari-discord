import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
} from 'discord.js';

import { destroyRoom, getRoom, joinRoom, startGame } from './roomManager';
import {
  buildSusunKataCancelId,
  buildSusunKataJoinId,
  buildSusunKataStartId,
  parseSusunKataComponentId,
} from './ids';
import { runGame as defaultRunGame } from './gameLoop';

interface ButtonHandlerDependencies {
  runGame?: typeof defaultRunGame;
}

function mentionList(userIds: string[]): string {
  return userIds.length === 0
    ? 'Belum ada pemain.'
    : userIds.map((userId) => `<@${userId}>`).join('\n');
}

export function createSusunKataLobbyEmbed(input: {
  creatorId: string;
  playerIds: string[];
  rounds: number;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Susun Kata')
    .setDescription(
      [
        'Ruang Susun Kata sudah dibuka.',
        `Pembuat: <@${input.creatorId}>`,
        `Ronde: **${input.rounds}**`,
        `Pemain: **${input.playerIds.length}**`,
      ].join('\n'),
    )
    .addFields({ name: 'Pemain Terdaftar', value: mentionList(input.playerIds) })
    .setFooter({ text: 'Gabung dulu, baru adu cepat menyusun kata.' });
}

export function createSusunKataLobbyComponents(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildSusunKataJoinId(channelId))
        .setLabel('Gabung Pertandingan')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildSusunKataStartId(channelId))
        .setLabel('Mulai Sekarang')
        .setEmoji('🏁')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(buildSusunKataCancelId(channelId))
        .setLabel('Batal')
        .setEmoji('🚫')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function roomEmbed(channelId: string): EmbedBuilder | null {
  const room = getRoom(channelId);
  if (!room) return null;
  return createSusunKataLobbyEmbed({
    creatorId: room.creatorId,
    playerIds: Array.from(room.players),
    rounds: room.rounds,
  });
}

async function handleJoin(interaction: ButtonInteraction, channelId: string): Promise<void> {
  const room = getRoom(channelId);
  if (!room || room.phase !== 'waiting') {
    await interaction.reply({ content: 'Lobby Susun Kata sudah tidak tersedia.', ephemeral: true });
    return;
  }

  if (room.players.has(interaction.user.id)) {
    await interaction.reply({ content: 'Kamu sudah masuk lobby Susun Kata.', ephemeral: true });
    return;
  }

  joinRoom(channelId, interaction.user.id);
  await interaction.deferUpdate();
  const embed = roomEmbed(channelId);
  if (embed) {
    await interaction.editReply({
      embeds: [embed],
      components: createSusunKataLobbyComponents(channelId),
    }).catch(() => undefined);
  }
  await interaction.followUp({ content: 'Kamu masuk pertandingan Susun Kata.', ephemeral: true });
}

async function handleStart(
  interaction: ButtonInteraction,
  channelId: string,
  dependencies: ButtonHandlerDependencies,
): Promise<void> {
  const room = getRoom(channelId);
  if (!room || room.phase !== 'waiting') {
    await interaction.reply({ content: 'Game ini sudah jalan atau lobby-nya sudah tidak aktif.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== room.creatorId) {
    await interaction.reply({ content: 'Tombol mulai cuma untuk pembuat room.', ephemeral: true });
    return;
  }

  startGame(channelId);
  await interaction.deferUpdate();
  await interaction.editReply({ components: [] }).catch(() => undefined);
  void (dependencies.runGame ?? defaultRunGame)(channelId, interaction.client);
}

async function handleCancel(interaction: ButtonInteraction, channelId: string): Promise<void> {
  const room = getRoom(channelId);
  if (!room || room.phase !== 'waiting') {
    await interaction.reply({ content: 'Lobby Susun Kata sudah tidak tersedia.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== room.creatorId) {
    await interaction.reply({ content: 'Tombol batal cuma untuk pembuat room.', ephemeral: true });
    return;
  }

  destroyRoom(channelId);
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Susun Kata Dibatalkan')
        .setDescription('Room ini dibubarkan. Channel sudah bebas untuk game baru.'),
    ],
    components: [],
  }).catch(() => undefined);
}

export async function handleSusunKataComponentInteraction(
  interaction: ButtonInteraction,
  dependencies: ButtonHandlerDependencies = {},
): Promise<boolean> {
  const parsed = parseSusunKataComponentId(interaction.customId);
  if (!parsed) return false;
  if (!interaction.isButton()) return true;

  if (parsed.kind === 'join') {
    await handleJoin(interaction, parsed.channelId);
    return true;
  }
  if (parsed.kind === 'start') {
    await handleStart(interaction, parsed.channelId, dependencies);
    return true;
  }

  await handleCancel(interaction, parsed.channelId);
  return true;
}
