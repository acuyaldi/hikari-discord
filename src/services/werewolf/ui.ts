import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import {
  buildWerewolfJoinId,
  buildWerewolfLaunchId,
  buildWerewolfNightActionId,
  buildWerewolfNightTargetId,
  buildWerewolfVoteId,
  type WerewolfNightAction,
} from './ids';
import type { WerewolfPhase, WerewolfPlayerRow, WerewolfRole, WerewolfVictory } from './types';

export const WEREWOLF_MIN_PLAYERS = 4;
export const WEREWOLF_DAY_DISCUSSION_MS = 60_000;
export const WEREWOLF_VOTE_MS = 60_000;
export const WEREWOLF_REGISTRATION_TIMEOUT_MS = 10 * 60_000;
export const WEREWOLF_NIGHT_ACTION_MS = 60_000;

function roleEmoji(role: WerewolfRole): string {
  switch (role) {
    case 'werewolf':
      return '🐺';
    case 'seer':
      return '🔮';
    default:
      return '🧑';
  }
}

function roleLabel(role: WerewolfRole): string {
  switch (role) {
    case 'werewolf':
      return 'Werewolf';
    case 'seer':
      return 'Seer';
    default:
      return 'Villager';
  }
}

function phaseEmoji(phase: WerewolfPhase): string {
  switch (phase) {
    case 'registration':
      return '📝';
    case 'launching':
      return 'â³';
    case 'night':
      return '🌙';
    case 'day':
      return '☀️';
    case 'voting':
      return '🗳️';
  }
}

function mentionList(userIds: string[]): string {
  return userIds.length === 0 ? 'Belum ada siapa-siapa. Sunyi juga.' : userIds.map((userId) => `<@${userId}>`).join('\n');
}

export function createRegistrationEmbed(input: {
  hostUserId: string;
  playerIds: string[];
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🐺 Werewolf Lobby')
    .setDescription(
      [
        'Game Werewolf siap dibuka.',
        'Tekan **Join Game** buat ikut. Host bisa tekan **Start Game** kalau pemain sudah cukup.',
        '',
        `Host: <@${input.hostUserId}>`,
        `Pemain: **${input.playerIds.length}/${WEREWOLF_MIN_PLAYERS}+**`,
      ].join('\n'),
    )
    .addFields({
      name: 'Pemain Terdaftar',
      value: mentionList(input.playerIds),
    })
    .setFooter({ text: 'Santai. Bohongnya nanti aja pas game mulai.' });
}

export function createLobbyExpiredEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setTitle('🐺 Werewolf Lobby Ditutup')
    .setDescription(
      `Tidak ada yang menekan **Start Game** dalam ${Math.round(WEREWOLF_REGISTRATION_TIMEOUT_MS / 60_000)} menit, jadi lobby ini otomatis dibubarkan. Buka lobby baru kalau mau main lagi.`,
    )
    .setFooter({ text: 'Auto-cleanup supaya lobby zombie nggak nyangkut selamanya.' });
}

export function createRegistrationComponents(guildId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildWerewolfJoinId(guildId))
        .setLabel('Join Game')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✋'),
      new ButtonBuilder()
        .setCustomId(buildWerewolfLaunchId(guildId))
        .setLabel('Start Game')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🚀'),
    ),
  ];
}

export function createPhaseEmbed(input: {
  phase: WerewolfPhase;
  alivePlayerIds: string[];
  body: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(input.phase === 'night' ? 0x2f3136 : input.phase === 'voting' ? 0xf1c40f : 0x57f287)
    .setTitle(`${phaseEmoji(input.phase)} Werewolf • ${input.phase.toUpperCase()}`)
    .setDescription(input.body)
    .addFields({
      name: 'Masih Hidup',
      value: mentionList(input.alivePlayerIds),
    });
}

export function createRoleDmEmbed(input: {
  role: WerewolfRole;
  teammateIds?: string[];
}): EmbedBuilder {
  const teammateText = input.role === 'werewolf' && input.teammateIds && input.teammateIds.length > 0
    ? `Werewolf lain: ${mentionList(input.teammateIds)}`
    : input.role === 'werewolf'
      ? 'Kamu main solo. Tegang, ya.'
      : input.role === 'seer'
        ? 'Setiap malam kamu bisa cek satu pemain.'
        : 'Tugasmu sederhana: kelihatan lugu, tetap hidup, dan jangan buang vote ke tempat aneh.';

  return new EmbedBuilder()
    .setColor(input.role === 'werewolf' ? 0xed4245 : input.role === 'seer' ? 0x9b59b6 : 0x95a5a6)
    .setTitle(`${roleEmoji(input.role)} Role Kamu: ${roleLabel(input.role)}`)
    .setDescription(teammateText)
    .setFooter({ text: 'Info ini rahasia. Jangan jadi legenda karena bocor di chat umum.' });
}

export function createNightActionButtonRow(guildId: string, action: WerewolfNightAction): ActionRowBuilder<ButtonBuilder>[] {
  const label = action === 'inspect' ? 'Check Player' : 'Kill Player';
  const emoji = action === 'inspect' ? '🔎' : '🗡️';
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildWerewolfNightActionId(guildId, action))
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(action === 'inspect' ? ButtonStyle.Primary : ButtonStyle.Danger),
    ),
  ];
}

export function createNightTargetMenu(
  guildId: string,
  action: WerewolfNightAction,
  options: Array<{ label: string; value: string; description?: string }>,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildWerewolfNightTargetId(guildId, action))
        .setPlaceholder(action === 'inspect' ? 'Pilih siapa yang mau dicek' : 'Pilih siapa yang mau dihabisi')
        .addOptions(
          options.map((option) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(option.label)
              .setValue(option.value)
              .setDescription(option.description ?? 'Pemain hidup'),
          ),
        ),
    ),
  ];
}

export function createVotingMenu(
  guildId: string,
  options: Array<{ label: string; value: string; description?: string }>,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildWerewolfVoteId(guildId))
        .setPlaceholder('Pilih pemain yang mau dikeluarkan')
        .addOptions(
          options.map((option) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(option.label)
              .setValue(option.value)
              .setDescription(option.description ?? 'Masih hidup'),
          ),
        ),
    ),
  ];
}

export function createGameOverEmbed(winner: WerewolfVictory, playerStates: WerewolfPlayerRow[]): EmbedBuilder {
  const werewolves = playerStates.filter((player) => player.role === 'werewolf').map((player) => `<@${player.user_id}>`);
  const villagers = playerStates.filter((player) => player.role !== 'werewolf').map((player) => `<@${player.user_id}>`);

  return new EmbedBuilder()
    .setColor(winner === 'villagers' ? 0x57f287 : 0xed4245)
    .setTitle(winner === 'villagers' ? '🎉 Villagers Menang!' : '🐺 Werewolves Menang!')
    .setDescription(
      winner === 'villagers'
        ? 'Para warga akhirnya sadar juga siapa yang mencurigakan. Butuh waktu, tapi ya sudahlah.'
        : 'Werewolf berhasil menyamakan jumlah dan mengambil alih desa. Brutal, tapi efektif.',
    )
    .addFields(
      { name: 'Werewolves', value: werewolves.join('\n') || 'Tidak ada', inline: true },
      { name: 'Villager Side', value: villagers.join('\n') || 'Tidak ada', inline: true },
    )
    .setFooter({ text: 'Game selesai. Kalau mau drama baru, buka lobby lagi.' });
}
