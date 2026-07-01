import {
  ChannelType,
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type MessageEditOptions,
  type StringSelectMenuInteraction,
  type TextBasedChannel,
} from 'discord.js';
import type Database from 'better-sqlite3';
import {
  assignWerewolfRoles,
  clearWerewolfNightTargets,
  clearWerewolfVotes,
  createWerewolfGame,
  deleteWerewolfGame,
  getWerewolfGame,
  getWerewolfPlayer,
  joinWerewolfGame,
  listAliveWerewolfPlayers,
  listWerewolfPlayers,
  setWerewolfAliveStatus,
  setWerewolfGameMessageId,
  setWerewolfNightTarget,
  setWerewolfPhase,
  setWerewolfPlayerDmChannel,
  setWerewolfVote,
} from './store';
import { assignRoles, evaluateWinCondition, tallyVotes } from './roles';
import { parseWerewolfComponentId, type WerewolfNightAction } from './ids';
import {
  createGameOverEmbed,
  createNightActionButtonRow,
  createNightTargetMenu,
  createPhaseEmbed,
  createRegistrationComponents,
  createRegistrationEmbed,
  createRoleDmEmbed,
  createVotingMenu,
  WEREWOLF_DAY_DISCUSSION_MS,
  WEREWOLF_MIN_PLAYERS,
  WEREWOLF_VOTE_MS,
} from './ui';
import type { WerewolfGameRow, WerewolfPlayerRow, WerewolfRole } from './types';

const dayTimers = new Map<string, NodeJS.Timeout>();
const voteTimers = new Map<string, NodeJS.Timeout>();

function clearGuildTimers(guildId: string): void {
  const dayTimer = dayTimers.get(guildId);
  if (dayTimer) {
    clearTimeout(dayTimer);
    dayTimers.delete(guildId);
  }

  const voteTimer = voteTimers.get(guildId);
  if (voteTimer) {
    clearTimeout(voteTimer);
    voteTimers.delete(guildId);
  }
}

function isTextChannel(channel: GuildBasedChannel | null): channel is GuildBasedChannel & TextBasedChannel {
  return channel !== null && channel.isTextBased();
}

async function fetchGameChannel(client: Client, game: WerewolfGameRow): Promise<(GuildBasedChannel & TextBasedChannel) | null> {
  const channel = await client.channels.fetch(game.channel_id).catch(() => null);
  if (!channel || !channel.isDMBased() && channel.type === ChannelType.GuildVoice) return null;
  return isTextChannel(channel as GuildBasedChannel | null) ? (channel as GuildBasedChannel & TextBasedChannel) : null;
}

async function fetchMainGameMessage(client: Client, game: WerewolfGameRow): Promise<Message | null> {
  if (!game.message_id) return null;
  const channel = await fetchGameChannel(client, game);
  if (!channel || !('messages' in channel)) return null;
  return channel.messages.fetch(game.message_id).catch(() => null);
}

async function setChannelNightLock(client: Client, game: WerewolfGameRow, locked: boolean): Promise<void> {
  const channel = await client.channels.fetch(game.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased() || !('permissionOverwrites' in channel) || !('guild' in channel)) return;
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    SendMessages: locked ? false : null,
  }).catch(() => undefined);
}

function alivePlayers(players: WerewolfPlayerRow[]): WerewolfPlayerRow[] {
  return players.filter((player) => player.is_alive === 1);
}

function mentionsForPlayers(players: WerewolfPlayerRow[]): string[] {
  return alivePlayers(players).map((player) => player.user_id);
}

async function updateRegistrationMessage(client: Client, db: Database.Database, guildId: string): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game) return;
  const players = listWerewolfPlayers(db, guildId);
  const message = await fetchMainGameMessage(client, game);
  if (!message) return;
  await message.edit({
    embeds: [createRegistrationEmbed({ hostUserId: game.host_user_id, playerIds: players.map((player) => player.user_id) })],
    components: createRegistrationComponents(guildId),
  });
}

async function updateMainGameMessage(
  client: Client,
  db: Database.Database,
  guildId: string,
  payload: { embeds: EmbedBuilder[]; components?: MessageEditOptions['components'] },
): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game) return;
  const message = await fetchMainGameMessage(client, game);
  if (!message) return;
  await message.edit({ embeds: payload.embeds, components: payload.components ?? [] }).catch(() => undefined);
}

async function displayName(client: Client, guildId: string, userId: string): Promise<string> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (member) return member.displayName;
  const user = await client.users.fetch(userId).catch(() => null);
  return user?.displayName ?? user?.username ?? userId;
}

async function buildSelectOptions(client: Client, guildId: string, players: WerewolfPlayerRow[]) {
  const options = [] as Array<{ label: string; value: string; description: string }>;
  for (const player of players) {
    options.push({
      label: await displayName(client, guildId, player.user_id),
      value: player.user_id,
      description: `Player ${player.user_id.slice(0, 6)}`,
    });
  }
  return options;
}

async function sendRoleAndNightPrompt(
  client: Client,
  db: Database.Database,
  guildId: string,
  players: WerewolfPlayerRow[],
  roleAssignments: Map<string, WerewolfRole>,
): Promise<{ failedUsers: string[] }> {
  const failedUsers: string[] = [];

  for (const player of players) {
    const role = roleAssignments.get(player.user_id) ?? player.role;
    try {
      const user = await client.users.fetch(player.user_id);
      const dmChannel = await user.createDM();
      setWerewolfPlayerDmChannel(db, guildId, player.user_id, dmChannel.id);
      const teammates = role === 'werewolf'
        ? players
          .filter((candidate) => candidate.user_id !== player.user_id && (roleAssignments.get(candidate.user_id) ?? candidate.role) === 'werewolf')
          .map((candidate) => candidate.user_id)
        : [];
      const embeds = [createRoleDmEmbed({ role, teammateIds: teammates })];
      const components =
        role === 'seer'
          ? createNightActionButtonRow(guildId, 'inspect')
          : role === 'werewolf'
            ? createNightActionButtonRow(guildId, 'kill')
            : [];
      await dmChannel.send({ embeds, components }).catch((error) => {
        throw error;
      });
    } catch {
      failedUsers.push(player.user_id);
    }
  }

  return { failedUsers };
}

async function sendNightPrompts(client: Client, db: Database.Database, guildId: string): Promise<void> {
  const players = alivePlayers(listWerewolfPlayers(db, guildId));
  const roleAssignments = new Map(players.map((player) => [player.user_id, player.role] as const));
  await sendRoleAndNightPrompt(client, db, guildId, players, roleAssignments);
}

function nightActors(players: WerewolfPlayerRow[]): WerewolfPlayerRow[] {
  return players.filter((player) => player.is_alive === 1 && (player.role === 'werewolf' || player.role === 'seer'));
}

function allNightActionsSubmitted(players: WerewolfPlayerRow[]): boolean {
  return nightActors(players).every((player) => player.night_target_user_id !== null);
}

function chooseNightVictim(players: WerewolfPlayerRow[]): WerewolfPlayerRow | null {
  const wolves = players.filter((player) => player.is_alive === 1 && player.role === 'werewolf');
  const counts = new Map<string, number>();
  for (const wolf of wolves) {
    if (!wolf.night_target_user_id) continue;
    counts.set(wolf.night_target_user_id, (counts.get(wolf.night_target_user_id) ?? 0) + 1);
  }

  let targetUserId: string | null = null;
  let highest = 0;
  let tie = false;
  for (const [candidateUserId, votes] of counts.entries()) {
    if (votes > highest) {
      highest = votes;
      targetUserId = candidateUserId;
      tie = false;
      continue;
    }
    if (votes === highest) tie = true;
  }

  if (!targetUserId || tie) return null;
  return players.find((player) => player.user_id === targetUserId && player.is_alive === 1) ?? null;
}

async function finishWerewolfGame(client: Client, db: Database.Database, guildId: string, winner: 'villagers' | 'werewolves'): Promise<void> {
  const players = listWerewolfPlayers(db, guildId);
  const game = getWerewolfGame(db, guildId);
  if (game) {
    await setChannelNightLock(client, game, false);
  }
  clearGuildTimers(guildId);
  await updateMainGameMessage(client, db, guildId, {
    embeds: [createGameOverEmbed(winner, players)],
    components: [],
  });
  deleteWerewolfGame(db, guildId);
}

async function startVotingPhase(client: Client, db: Database.Database, guildId: string): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game) return;
  const players = alivePlayers(listWerewolfPlayers(db, guildId));
  if (players.length === 0) return;

  clearWerewolfVotes(db, guildId);
  setWerewolfPhase(db, guildId, 'voting');

  const voteOptions = await buildSelectOptions(client, guildId, players);
  await updateMainGameMessage(client, db, guildId, {
    embeds: [createPhaseEmbed({
      phase: 'voting',
      alivePlayerIds: players.map((player) => player.user_id),
      body: 'Waktunya voting. Pilih siapa yang mau kamu keluarkan. Jangan sok polos kalau jelas-jelas mencurigakan.',
    })],
    components: createVotingMenu(guildId, voteOptions),
  });

  const timer = setTimeout(() => {
    void resolveVotingPhase(client, db, guildId);
  }, WEREWOLF_VOTE_MS);
  voteTimers.set(guildId, timer);
}

async function startDayPhase(
  client: Client,
  db: Database.Database,
  guildId: string,
  input: { victimUserId: string | null; reason: 'night' | 'vote'; tie?: boolean },
): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game) return;

  await setChannelNightLock(client, game, false);
  setWerewolfPhase(db, guildId, 'day');
  const players = listWerewolfPlayers(db, guildId);
  const aliveUserIds = mentionsForPlayers(players);
  const victimText = input.tie
    ? 'Tidak ada yang mati. Hasilnya seri. Canggung, ya.'
    : input.victimUserId
      ? `<@${input.victimUserId}> ${input.reason === 'night' ? 'tidak selamat melewati malam.' : 'resmi dikeluarkan dari desa.'}`
      : 'Semua orang selamat. Aneh, tapi silakan panik pelan-pelan.';

  await updateMainGameMessage(client, db, guildId, {
    embeds: [createPhaseEmbed({
      phase: 'day',
      alivePlayerIds: aliveUserIds,
      body: `${victimText}\n\nDiskusi dibuka selama ${Math.round(WEREWOLF_DAY_DISCUSSION_MS / 1000)} detik sebelum voting dimulai otomatis.`,
    })],
    components: [],
  });

  const winner = evaluateWinCondition(players);
  if (winner) {
    await finishWerewolfGame(client, db, guildId, winner);
    return;
  }

  clearGuildTimers(guildId);
  const timer = setTimeout(() => {
    void startVotingPhase(client, db, guildId);
  }, WEREWOLF_DAY_DISCUSSION_MS);
  dayTimers.set(guildId, timer);
}

async function startNightPhase(client: Client, db: Database.Database, guildId: string, note?: string): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game) return;
  clearGuildTimers(guildId);
  clearWerewolfVotes(db, guildId);
  clearWerewolfNightTargets(db, guildId);
  setWerewolfPhase(db, guildId, 'night');
  await setChannelNightLock(client, game, true);

  const players = listWerewolfPlayers(db, guildId);
  await updateMainGameMessage(client, db, guildId, {
    embeds: [createPhaseEmbed({
      phase: 'night',
      alivePlayerIds: mentionsForPlayers(players),
      body: `${note ?? 'Malam turun. Channel dikunci. Role rahasia, silakan cek DM dan jalankan aksimu.'}`,
    })],
    components: [],
  });

  await sendNightPrompts(client, db, guildId);
}

async function resolveNightPhase(client: Client, db: Database.Database, guildId: string): Promise<void> {
  const players = listWerewolfPlayers(db, guildId);
  const victim = chooseNightVictim(players);
  if (victim) {
    setWerewolfAliveStatus(db, guildId, victim.user_id, false);
  }
  await startDayPhase(client, db, guildId, {
    victimUserId: victim?.user_id ?? null,
    reason: 'night',
  });
}

async function resolveVotingPhase(client: Client, db: Database.Database, guildId: string): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game) return;
  const players = listWerewolfPlayers(db, guildId);
  clearGuildTimers(guildId);
  const voteResult = tallyVotes(players);
  if (voteResult.targetUserId) {
    setWerewolfAliveStatus(db, guildId, voteResult.targetUserId, false);
  }

  const latestPlayers = listWerewolfPlayers(db, guildId);
  const winner = evaluateWinCondition(latestPlayers);
  if (winner) {
    await finishWerewolfGame(client, db, guildId, winner);
    return;
  }

  if (voteResult.targetUserId) {
    await startNightPhase(client, db, guildId, `<@${voteResult.targetUserId}> keluar dari permainan. Malam berikutnya dimulai sekarang.`);
    return;
  }

  await startNightPhase(client, db, guildId, 'Voting berakhir seri. Tidak ada yang keluar. Bagus, desa ini makin kacau.');
}

function ensureGuild(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction): string | null {
  return interaction.guildId ?? null;
}

export async function startWerewolfRegistration(
  interaction: ChatInputCommandInteraction,
  db: Database.Database,
): Promise<void> {
  const guildId = ensureGuild(interaction);
  if (!guildId || !interaction.channelId) {
    await interaction.reply({ content: 'Werewolf cuma bisa dijalankan di server.', ephemeral: true });
    return;
  }

  const existing = getWerewolfGame(db, guildId);
  if (existing) {
    await interaction.reply({ content: 'Masih ada game Werewolf aktif di server ini. Selesaikan dulu yang itu.', ephemeral: true });
    return;
  }

  await interaction.reply({
    embeds: [createRegistrationEmbed({ hostUserId: interaction.user.id, playerIds: [interaction.user.id] })],
    components: createRegistrationComponents(guildId),
    fetchReply: true,
  });
  const reply = await interaction.fetchReply();
  createWerewolfGame(db, {
    guildId,
    channelId: interaction.channelId,
    hostUserId: interaction.user.id,
    messageId: reply.id,
  });
  joinWerewolfGame(db, { guildId, userId: interaction.user.id });
}

export async function forceWerewolfVoting(interaction: ChatInputCommandInteraction, db: Database.Database): Promise<void> {
  const guildId = ensureGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: 'Command ini cuma jalan di server.', ephemeral: true });
    return;
  }
  const game = getWerewolfGame(db, guildId);
  if (!game) {
    await interaction.reply({ content: 'Belum ada game Werewolf aktif di server ini.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== game.host_user_id) {
    await interaction.reply({ content: 'Yang boleh paksa voting cuma host game. Demokrasi ada batasnya.', ephemeral: true });
    return;
  }
  await interaction.reply({ content: 'Sip. Voting dipercepat.', ephemeral: true });
  await startVotingPhase(interaction.client, db, guildId);
}

export async function cancelWerewolfGame(interaction: ChatInputCommandInteraction, db: Database.Database): Promise<void> {
  const guildId = ensureGuild(interaction);
  if (!guildId) {
    await interaction.reply({ content: 'Command ini cuma jalan di server.', ephemeral: true });
    return;
  }
  const game = getWerewolfGame(db, guildId);
  if (!game) {
    await interaction.reply({ content: 'Belum ada game Werewolf aktif di server ini.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== game.host_user_id) {
    await interaction.reply({ content: 'Yang boleh membubarkan game ini cuma host-nya.', ephemeral: true });
    return;
  }
  await interaction.reply({ content: 'Game Werewolf dibatalkan. Dramanya disimpan untuk nanti.', ephemeral: true });
  await finishWerewolfGame(interaction.client, db, guildId, 'villagers');
}

async function handleJoin(interaction: ButtonInteraction, db: Database.Database, guildId: string): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game || game.phase !== 'registration') {
    await interaction.reply({ content: 'Lobby-nya sudah tutup atau game-nya sudah jalan.', ephemeral: true });
    return;
  }

  const player = getWerewolfPlayer(db, guildId, interaction.user.id);
  if (player) {
    await interaction.reply({ content: 'Kamu sudah masuk lobby. Tenang, datamu aman. Untuk saat ini.', ephemeral: true });
    return;
  }

  joinWerewolfGame(db, { guildId, userId: interaction.user.id });
  await interaction.deferUpdate();
  await updateRegistrationMessage(interaction.client, db, guildId);
  await interaction.followUp({ content: 'Kamu masuk game. Semoga jujur kalau dapat role baik. Semoga pandai bohong kalau tidak.', ephemeral: true });
}

async function handleLaunch(interaction: ButtonInteraction, db: Database.Database, guildId: string): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game || game.phase !== 'registration') {
    await interaction.reply({ content: 'Game ini sudah jalan atau lobby-nya sudah tidak aktif.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== game.host_user_id) {
    await interaction.reply({ content: 'Tombol start ini cuma buat host. Kudeta ditolak.', ephemeral: true });
    return;
  }

  const players = listWerewolfPlayers(db, guildId);
  if (players.length < WEREWOLF_MIN_PLAYERS) {
    await interaction.reply({ content: `Minimal ${WEREWOLF_MIN_PLAYERS} pemain dulu. Sekarang masih ${players.length}.`, ephemeral: true });
    return;
  }

  const assignments = assignRoles(players.map((player) => player.user_id));
  const roleMap = new Map(assignments.map((assignment) => [assignment.userId, assignment.role] as const));
  const dmResult = await sendRoleAndNightPrompt(interaction.client, db, guildId, players, roleMap);

  if (dmResult.failedUsers.length > 0) {
    await interaction.reply({
      content: `Game belum bisa dimulai. DM tertutup untuk: ${dmResult.failedUsers.map((userId) => `<@${userId}>`).join(', ')}`,
      ephemeral: true,
    });
    const channel = await fetchGameChannel(interaction.client, game);
    await channel?.send(`⚠️ Werewolf belum dimulai karena DM tertutup untuk ${dmResult.failedUsers.map((userId) => `<@${userId}>`).join(', ')}.`).catch(() => undefined);
    return;
  }

  assignWerewolfRoles(db, guildId, assignments);
  await interaction.deferUpdate();
  await startNightPhase(interaction.client, db, guildId);
}

async function handleNightActionButton(
  interaction: ButtonInteraction,
  db: Database.Database,
  guildId: string,
  action: WerewolfNightAction,
): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game || game.phase !== 'night') {
    await interaction.reply({ content: 'Belum waktunya aksi malam.', ephemeral: true });
    return;
  }

  const player = getWerewolfPlayer(db, guildId, interaction.user.id);
  if (!player || player.is_alive !== 1) {
    await interaction.reply({ content: 'Kamu tidak aktif di game ini, atau sudah tumbang. Hidup memang keras.', ephemeral: true });
    return;
  }

  const expectedRole = action === 'inspect' ? 'seer' : 'werewolf';
  if (player.role !== expectedRole) {
    await interaction.reply({ content: 'Tombol ini bukan buat role kamu.', ephemeral: true });
    return;
  }

  if (player.night_target_user_id) {
    await interaction.reply({ content: 'Aksi malammu sudah tercatat. Satu malam, satu keputusan. Hidup itu adil.', ephemeral: true });
    return;
  }

  const players = alivePlayers(listWerewolfPlayers(db, guildId)).filter((candidate) => {
    if (candidate.user_id === interaction.user.id) return false;
    if (action === 'kill' && candidate.role === 'werewolf') return false;
    return true;
  });

  const options = await buildSelectOptions(interaction.client, guildId, players);
  await interaction.reply({
    content: action === 'inspect' ? 'Pilih satu pemain untuk dicek.' : 'Pilih target untuk malam ini.',
    components: createNightTargetMenu(guildId, action, options),
  });
}

async function handleNightTargetSelect(
  interaction: StringSelectMenuInteraction,
  db: Database.Database,
  guildId: string,
  action: WerewolfNightAction,
): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game || game.phase !== 'night') {
    await interaction.reply({ content: 'Aksi malamnya sudah lewat.', ephemeral: true });
    return;
  }

  const player = getWerewolfPlayer(db, guildId, interaction.user.id);
  if (!player || player.is_alive !== 1) {
    await interaction.reply({ content: 'Kamu tidak bisa ikut aksi malam ini.', ephemeral: true });
    return;
  }

  const targetUserId = interaction.values[0];
  const expectedRole = action === 'inspect' ? 'seer' : 'werewolf';
  if (player.role !== expectedRole) {
    await interaction.reply({ content: 'Pilihan ini bukan buat role kamu.', ephemeral: true });
    return;
  }
  if (player.night_target_user_id) {
    await interaction.reply({ content: 'Aksimu malam ini sudah terkunci.', ephemeral: true });
    return;
  }

  setWerewolfNightTarget(db, guildId, interaction.user.id, targetUserId);
  const targetPlayer = getWerewolfPlayer(db, guildId, targetUserId);
  const targetName = await displayName(interaction.client, guildId, targetUserId);

  if (action === 'inspect') {
    const resultText = targetPlayer?.role === 'werewolf' ? 'target ini Werewolf.' : 'target ini bukan Werewolf.';
    await interaction.update({
      content: `🔮 Hasil cek untuk **${targetName}**: ${resultText}`,
      components: [],
    });
  } else {
    await interaction.update({
      content: `🗡️ Targetmu malam ini tercatat: **${targetName}**. Semoga keputusanmu tidak memalukan.`,
      components: [],
    });
  }

  const players = listWerewolfPlayers(db, guildId);
  if (allNightActionsSubmitted(players)) {
    await resolveNightPhase(interaction.client, db, guildId);
  }
}

async function handleVoteSelect(interaction: StringSelectMenuInteraction, db: Database.Database, guildId: string): Promise<void> {
  const game = getWerewolfGame(db, guildId);
  if (!game || game.phase !== 'voting') {
    await interaction.reply({ content: 'Belum waktunya voting.', ephemeral: true });
    return;
  }

  const player = getWerewolfPlayer(db, guildId, interaction.user.id);
  if (!player || player.is_alive !== 1) {
    await interaction.reply({ content: 'Kamu tidak bisa ikut voting ini.', ephemeral: true });
    return;
  }

  const targetUserId = interaction.values[0];
  const targetPlayer = getWerewolfPlayer(db, guildId, targetUserId);
  if (!targetPlayer || targetPlayer.is_alive !== 1) {
    await interaction.reply({ content: 'Target vote itu sudah tidak valid.', ephemeral: true });
    return;
  }

  setWerewolfVote(db, guildId, interaction.user.id, targetUserId);
  const targetName = await displayName(interaction.client, guildId, targetUserId);
  await interaction.reply({ content: `🗳️ Vote kamu masuk untuk **${targetName}**. Sekarang mari pura-pura tidak gugup.`, ephemeral: true });

  const players = alivePlayers(listWerewolfPlayers(db, guildId));
  const everyoneVoted = players.every((candidate) => candidate.voted_for !== null);
  if (everyoneVoted) {
    await resolveVotingPhase(interaction.client, db, guildId);
  }
}

export async function handleWerewolfComponentInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  db: Database.Database,
): Promise<boolean> {
  const parsed = parseWerewolfComponentId(interaction.customId);
  if (!parsed) return false;

  switch (parsed.kind) {
    case 'join':
      if (!interaction.isButton()) return true;
      await handleJoin(interaction, db, parsed.guildId);
      return true;
    case 'launch':
      if (!interaction.isButton()) return true;
      await handleLaunch(interaction, db, parsed.guildId);
      return true;
    case 'night-action':
      if (!interaction.isButton()) return true;
      await handleNightActionButton(interaction, db, parsed.guildId, parsed.action);
      return true;
    case 'night-target':
      if (!interaction.isStringSelectMenu()) return true;
      await handleNightTargetSelect(interaction, db, parsed.guildId, parsed.action);
      return true;
    case 'vote':
      if (!interaction.isStringSelectMenu()) return true;
      await handleVoteSelect(interaction, db, parsed.guildId);
      return true;
  }
}