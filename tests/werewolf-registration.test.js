require('ts-node/register/transpile-only');

const Database = require('better-sqlite3');
const { ChannelType } = require('discord.js');

const {
  startWerewolfRegistration,
  handleWerewolfComponentInteraction,
  forceWerewolfVoting,
} = require('../src/services/werewolf/game');
const {
  buildWerewolfJoinId,
  buildWerewolfLaunchId,
  buildWerewolfNightActionId,
  buildWerewolfNightTargetId,
  buildWerewolfVoteId,
} = require('../src/services/werewolf/ids');
const { joinWerewolfGame } = require('../src/services/werewolf/store');
const { WEREWOLF_NIGHT_ACTION_MS, WEREWOLF_REGISTRATION_TIMEOUT_MS } = require('../src/services/werewolf/ui');

function createWerewolfSchema(db) {
  db.prepare(`
    CREATE TABLE ww_games (
      guild_id                TEXT PRIMARY KEY,
      channel_id              TEXT NOT NULL,
      host_user_id            TEXT NOT NULL,
      phase                   TEXT NOT NULL,
      message_id              TEXT,
      day_message_id          TEXT,
      phase_started_at        INTEGER,
      registration_started_at INTEGER,
      created_at              INTEGER NOT NULL,
      updated_at              INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE ww_players (
      guild_id               TEXT NOT NULL,
      user_id                TEXT NOT NULL,
      role                   TEXT NOT NULL DEFAULT 'villager',
      is_alive               INTEGER NOT NULL DEFAULT 1,
      voted_for              TEXT,
      dm_channel_id          TEXT,
      night_target_user_id   TEXT,
      last_action_at         INTEGER,
      joined_at              INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `).run();
}

function createMockClient(options = {}) {
  const dmFailures = options.dmFailures instanceof Set ? options.dmFailures : new Set(options.dmFailures ?? []);
  const mainMessage = {
    id: options.mainMessageId ?? 'main-message-1',
    edit: jest.fn(async () => undefined),
  };

  const channel = {
    id: options.channelId ?? 'channel-1',
    type: ChannelType.GuildText,
    isDMBased: () => false,
    isTextBased: () => true,
    messages: {
      fetch: jest.fn(async (messageId) => {
        if (messageId === mainMessage.id) return mainMessage;
        throw new Error('message not found');
      }),
    },
    permissionOverwrites: {
      edit: jest.fn(async () => undefined),
    },
    guild: {
      roles: {
        everyone: 'everyone-role',
      },
    },
    send: jest.fn(async () => undefined),
  };

  const dmSend = jest.fn(async () => undefined);

  const client = {
    channels: {
      fetch: jest.fn(async (channelId) => {
        if (channelId === channel.id) return channel;
        throw new Error('channel not found');
      }),
    },
    users: {
      fetch: jest.fn(async (userId) => ({
        id: userId,
        username: `user-${userId}`,
        displayName: `User ${userId}`,
        createDM: jest.fn(async () => ({
          id: `dm-${userId}`,
          send: dmFailures.has(userId)
            ? jest.fn(async () => {
              throw new Error('DM closed');
            })
            : dmSend,
        })),
      })),
    },
    guilds: {
      fetch: jest.fn(async () => ({
        members: {
          fetch: jest.fn(async (userId) => ({
            id: userId,
            displayName: `Member ${userId}`,
          })),
        },
      })),
    },
  };

  return { client, channel, mainMessage, dmSend, dmFailures };
}

function createStartInteraction(options = {}) {
  const client = options.client;
  const guildId = options.guildId ?? 'guild-1';
  const channelId = options.channelId ?? 'channel-1';
  const userId = options.userId ?? 'host-1';
  const fetchReplyResult = {
    id: options.replyMessageId ?? 'main-message-1',
  };

  const interaction = {
    guildId,
    channelId,
    user: { id: userId },
    client,
    reply: jest.fn(async () => fetchReplyResult),
    fetchReply: jest.fn(async () => fetchReplyResult),
  };

  return { interaction, fetchReplyResult };
}

function createButtonInteraction(options) {
  return {
    customId: options.customId,
    guildId: options.guildId ?? 'guild-1',
    user: { id: options.userId },
    client: options.client,
    isButton: () => true,
    isStringSelectMenu: () => false,
    reply: jest.fn(async () => undefined),
    deferUpdate: jest.fn(async () => undefined),
    followUp: jest.fn(async () => undefined),
  };
}

function createSelectInteraction(options) {
  return {
    customId: options.customId,
    guildId: options.guildId ?? 'guild-1',
    user: { id: options.userId },
    client: options.client,
    values: options.values ?? [],
    isButton: () => false,
    isStringSelectMenu: () => true,
    reply: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
  };
}

function createCommandInteraction(options) {
  return {
    guildId: options.guildId ?? 'guild-1',
    user: { id: options.userId ?? 'host-1' },
    client: options.client,
    reply: jest.fn(async () => undefined),
  };
}

function startGameAndSeedHost(db, client, options = {}) {
  const { interaction } = createStartInteraction({
    client,
    guildId: options.guildId,
    channelId: options.channelId,
    userId: options.hostUserId,
    replyMessageId: options.replyMessageId,
  });

  return startWerewolfRegistration(interaction, db);
}

async function launchReadyGameWithFourPlayers(db, client) {
  await startGameAndSeedHost(db, client);
  joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-2' });
  joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-3' });
  joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-4' });

  const launchInteraction = createButtonInteraction({
    customId: buildWerewolfLaunchId('guild-1'),
    userId: 'host-1',
    client,
  });

  await handleWerewolfComponentInteraction(launchInteraction, db);

  return launchInteraction;
}

describe('Werewolf registration integration (Start -> Join -> Launch)', () => {
  let db;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    db = new Database(':memory:');
    createWerewolfSchema(db);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    db.close();
  });

  describe('Scenario A: Game Initialization (/werewolf start)', () => {
    test('creates a registration game and replies with embed + Join/Launch buttons', async () => {
      const { client } = createMockClient();
      const { interaction } = createStartInteraction({ client });

      await startWerewolfRegistration(interaction, db);

      const game = db.prepare('SELECT * FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game).toBeTruthy();
      expect(game.phase).toBe('registration');
      expect(game.host_user_id).toBe('host-1');
      expect(game.channel_id).toBe('channel-1');

      const players = db.prepare('SELECT * FROM ww_players WHERE guild_id = ? ORDER BY joined_at ASC').all('guild-1');
      expect(players).toHaveLength(1);
      expect(players[0].user_id).toBe('host-1');

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const payload = interaction.reply.mock.calls[0][0];
      expect(payload.embeds).toHaveLength(1);
      expect(payload.components).toHaveLength(1);

      const buttonCustomIds = payload.components[0].components.map((button) => button.data.custom_id);
      const buttonLabels = payload.components[0].components.map((button) => button.data.label);

      expect(buttonCustomIds).toEqual(
        expect.arrayContaining([buildWerewolfJoinId('guild-1'), buildWerewolfLaunchId('guild-1')]),
      );
      expect(buttonLabels).toEqual(expect.arrayContaining(['Join Game', 'Start Game']));
    });

    test('rejects starting a second active game in the same guild', async () => {
      const { client } = createMockClient();
      const first = createStartInteraction({ client, userId: 'host-1' });
      const second = createStartInteraction({ client, userId: 'host-2' });

      await startWerewolfRegistration(first.interaction, db);
      await startWerewolfRegistration(second.interaction, db);

      const games = db.prepare('SELECT * FROM ww_games WHERE guild_id = ?').all('guild-1');
      expect(games).toHaveLength(1);
      expect(games[0].host_user_id).toBe('host-1');

      expect(second.interaction.reply).toHaveBeenCalledTimes(1);
      expect(second.interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeral: true,
          content: expect.stringMatching(/aktif di server ini/i),
        }),
      );
    });
  });

  describe('Scenario B: Player Joining (Join Button)', () => {
    test('adds a player to ww_players and updates registration embed count', async () => {
      const { client, mainMessage } = createMockClient();
      await startGameAndSeedHost(db, client);

      const joinInteraction = createButtonInteraction({
        customId: buildWerewolfJoinId('guild-1'),
        userId: 'user-2',
        client,
      });

      const handled = await handleWerewolfComponentInteraction(joinInteraction, db);

      expect(handled).toBe(true);
      const players = db.prepare('SELECT * FROM ww_players WHERE guild_id = ? ORDER BY joined_at ASC').all('guild-1');
      expect(players.map((player) => player.user_id)).toEqual(['host-1', 'user-2']);

      expect(joinInteraction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(joinInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true }),
      );

      expect(mainMessage.edit).toHaveBeenCalledTimes(1);
      const editPayload = mainMessage.edit.mock.calls[0][0];
      expect(editPayload.embeds[0].data.description).toContain('Pemain: **2/4+**');
    });

    test('does not duplicate records when the same user clicks Join repeatedly', async () => {
      const { client } = createMockClient();
      await startGameAndSeedHost(db, client);

      const joinInteraction = createButtonInteraction({
        customId: buildWerewolfJoinId('guild-1'),
        userId: 'user-2',
        client,
      });

      await handleWerewolfComponentInteraction(joinInteraction, db);
      await handleWerewolfComponentInteraction(joinInteraction, db);

      const userRows = db.prepare('SELECT * FROM ww_players WHERE guild_id = ? AND user_id = ?').all('guild-1', 'user-2');
      expect(userRows).toHaveLength(1);
      expect(joinInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeral: true,
          content: expect.stringMatching(/sudah masuk lobby/i),
        }),
      );
    });
  });

  describe('Scenario C: Launch constraints and execution (Launch Button)', () => {
    test('rejects launch when player count is less than 4 and keeps phase registration', async () => {
      const { client } = createMockClient();
      await startGameAndSeedHost(db, client);

      const launchInteraction = createButtonInteraction({
        customId: buildWerewolfLaunchId('guild-1'),
        userId: 'host-1',
        client,
      });

      await handleWerewolfComponentInteraction(launchInteraction, db);

      expect(launchInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeral: true,
          content: expect.stringMatching(/minimal 4 pemain/i),
        }),
      );

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game.phase).toBe('registration');
    });

    test('rejects non-host launch attempts with ephemeral warning', async () => {
      const { client } = createMockClient();
      await startGameAndSeedHost(db, client);
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-2' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-3' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-4' });

      const launchInteraction = createButtonInteraction({
        customId: buildWerewolfLaunchId('guild-1'),
        userId: 'user-2',
        client,
      });

      await handleWerewolfComponentInteraction(launchInteraction, db);

      expect(launchInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeral: true,
          content: expect.stringMatching(/cuma buat host/i),
        }),
      );

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game.phase).toBe('registration');
    });

    test('host can launch with >= 4 players, game moves to night, and roles are assigned', async () => {
      const { client } = createMockClient();
      const launchInteraction = await launchReadyGameWithFourPlayers(db, client);

      expect(launchInteraction.deferUpdate).toHaveBeenCalledTimes(1);
      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(['setup', 'night']).toContain(game.phase);

      const players = db.prepare('SELECT user_id, role FROM ww_players WHERE guild_id = ? ORDER BY joined_at ASC').all('guild-1');
      expect(players).toHaveLength(4);
      for (const player of players) {
        expect(['villager', 'seer', 'werewolf']).toContain(player.role);
      }

      const roles = players.map((player) => player.role);
      expect(roles).toContain('seer');
      expect(roles).toContain('werewolf');

      expect(client.users.fetch).toHaveBeenCalled();
    });

    test('concurrent launch clicks send only one role DM per player', async () => {
      const { client, dmSend } = createMockClient();
      await startGameAndSeedHost(db, client);
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-2' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-3' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-4' });

      const firstLaunchInteraction = createButtonInteraction({
        customId: buildWerewolfLaunchId('guild-1'),
        userId: 'host-1',
        client,
      });
      const secondLaunchInteraction = createButtonInteraction({
        customId: buildWerewolfLaunchId('guild-1'),
        userId: 'host-1',
        client,
      });

      await Promise.all([
        handleWerewolfComponentInteraction(firstLaunchInteraction, db),
        handleWerewolfComponentInteraction(secondLaunchInteraction, db),
      ]);

      expect(dmSend).toHaveBeenCalledTimes(4);
      expect(
        firstLaunchInteraction.deferUpdate.mock.calls.length
        + secondLaunchInteraction.deferUpdate.mock.calls.length,
      ).toBe(1);
    });

    test('retrying launch after a closed DM does not resend duplicate role DMs to already-notified players', async () => {
      const { client, dmSend, dmFailures } = createMockClient({ dmFailures: ['user-4'] });
      await startGameAndSeedHost(db, client);
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-2' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-3' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-4' });

      const firstLaunchInteraction = createButtonInteraction({
        customId: buildWerewolfLaunchId('guild-1'),
        userId: 'host-1',
        client,
      });

      await handleWerewolfComponentInteraction(firstLaunchInteraction, db);

      expect(dmSend).toHaveBeenCalledTimes(3);
      expect(firstLaunchInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/DM tertutup/i) }),
      );

      let gameAfterFailure = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(gameAfterFailure.phase).toBe('registration');

      dmFailures.delete('user-4');

      const secondLaunchInteraction = createButtonInteraction({
        customId: buildWerewolfLaunchId('guild-1'),
        userId: 'host-1',
        client,
      });

      await handleWerewolfComponentInteraction(secondLaunchInteraction, db);

      // Only the previously-failed player (user-4) should receive a new DM on retry.
      expect(dmSend).toHaveBeenCalledTimes(4);
      expect(secondLaunchInteraction.deferUpdate).toHaveBeenCalledTimes(1);

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game.phase).toBe('night');

      const roles = db
        .prepare('SELECT role FROM ww_players WHERE guild_id = ?')
        .all('guild-1')
        .map((row) => row.role);
      expect(roles).toHaveLength(4);
      expect(roles).toContain('seer');
      expect(roles).toContain('werewolf');
    });
  });

  describe('Scenario D: Night action integration', () => {
    test('seer can open inspect target menu and submit target, persisting night action in DB', async () => {
      const { client } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      const seer = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role = ?')
        .get('guild-1', 'seer');
      const inspectTarget = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND user_id != ? LIMIT 1')
        .get('guild-1', seer.user_id);

      const inspectButtonInteraction = createButtonInteraction({
        customId: buildWerewolfNightActionId('guild-1', 'inspect'),
        userId: seer.user_id,
        client,
      });

      const handledInspectButton = await handleWerewolfComponentInteraction(inspectButtonInteraction, db);

      expect(handledInspectButton).toBe(true);
      expect(inspectButtonInteraction.reply).toHaveBeenCalledTimes(1);
      expect(inspectButtonInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/pilih satu pemain untuk dicek/i),
          components: expect.any(Array),
        }),
      );

      const inspectSelectInteraction = createSelectInteraction({
        customId: buildWerewolfNightTargetId('guild-1', 'inspect'),
        userId: seer.user_id,
        values: [inspectTarget.user_id],
        client,
      });

      const handledInspectSelect = await handleWerewolfComponentInteraction(inspectSelectInteraction, db);

      expect(handledInspectSelect).toBe(true);
      expect(inspectSelectInteraction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/hasil cek/i),
          components: [],
        }),
      );

      const seerRow = db
        .prepare('SELECT night_target_user_id FROM ww_players WHERE guild_id = ? AND user_id = ?')
        .get('guild-1', seer.user_id);
      expect(seerRow.night_target_user_id).toBe(inspectTarget.user_id);
    });

    test('werewolf can submit kill target and target is recorded in ww_players', async () => {
      const { client } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      const werewolf = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role = ? LIMIT 1')
        .get('guild-1', 'werewolf');
      const killTarget = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role != ? LIMIT 1')
        .get('guild-1', 'werewolf');

      const killButtonInteraction = createButtonInteraction({
        customId: buildWerewolfNightActionId('guild-1', 'kill'),
        userId: werewolf.user_id,
        client,
      });

      await handleWerewolfComponentInteraction(killButtonInteraction, db);

      expect(killButtonInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/pilih target/i),
          components: expect.any(Array),
        }),
      );

      const killSelectInteraction = createSelectInteraction({
        customId: buildWerewolfNightTargetId('guild-1', 'kill'),
        userId: werewolf.user_id,
        values: [killTarget.user_id],
        client,
      });

      await handleWerewolfComponentInteraction(killSelectInteraction, db);

      expect(killSelectInteraction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/targetmu malam ini tercatat/i),
          components: [],
        }),
      );

      const wolfRow = db
        .prepare('SELECT night_target_user_id FROM ww_players WHERE guild_id = ? AND user_id = ?')
        .get('guild-1', werewolf.user_id);
      expect(wolfRow.night_target_user_id).toBe(killTarget.user_id);
    });
  });

  describe('Scenario E: Voting integration end-to-end', () => {
    test('decisive voting eliminates target player and transitions game back to night', async () => {
      const { client } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      db.prepare('UPDATE ww_games SET phase = ? WHERE guild_id = ?').run('voting', 'guild-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('werewolf', 'guild-1', 'host-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('seer', 'guild-1', 'user-2');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('villager', 'guild-1', 'user-3');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('villager', 'guild-1', 'user-4');

      const votes = [
        { userId: 'host-1', target: 'user-2' },
        { userId: 'user-2', target: 'host-1' },
        { userId: 'user-3', target: 'user-2' },
        { userId: 'user-4', target: 'user-2' },
      ];

      const interactions = [];
      for (const vote of votes) {
        const interaction = createSelectInteraction({
          customId: buildWerewolfVoteId('guild-1'),
          userId: vote.userId,
          values: [vote.target],
          client,
        });
        interactions.push(interaction);
        const handled = await handleWerewolfComponentInteraction(interaction, db);
        expect(handled).toBe(true);
      }

      for (const interaction of interactions) {
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            ephemeral: true,
            content: expect.stringMatching(/vote kamu masuk/i),
          }),
        );
      }

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game.phase).toBe('night');

      const eliminated = db
        .prepare('SELECT is_alive FROM ww_players WHERE guild_id = ? AND user_id = ?')
        .get('guild-1', 'user-2');
      expect(eliminated.is_alive).toBe(0);
    });

    test('tie voting keeps all players alive and still transitions back to night', async () => {
      const { client } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      db.prepare('UPDATE ww_games SET phase = ? WHERE guild_id = ?').run('voting', 'guild-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('werewolf', 'guild-1', 'host-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('seer', 'guild-1', 'user-2');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('villager', 'guild-1', 'user-3');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('villager', 'guild-1', 'user-4');

      const tieVotes = [
        { userId: 'host-1', target: 'user-2' },
        { userId: 'user-2', target: 'host-1' },
        { userId: 'user-3', target: 'user-2' },
        { userId: 'user-4', target: 'host-1' },
      ];

      for (const vote of tieVotes) {
        const interaction = createSelectInteraction({
          customId: buildWerewolfVoteId('guild-1'),
          userId: vote.userId,
          values: [vote.target],
          client,
        });
        const handled = await handleWerewolfComponentInteraction(interaction, db);
        expect(handled).toBe(true);
      }

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game.phase).toBe('night');

      const deadCount = db
        .prepare('SELECT COUNT(*) AS count FROM ww_players WHERE guild_id = ? AND is_alive = 0')
        .get('guild-1').count;
      expect(deadCount).toBe(0);
    });
  });

  describe('Scenario F: Win condition and cleanup integration', () => {
    test('villagers win removes active game rows and unlocks channel', async () => {
      const { client, channel, mainMessage } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      db.prepare('UPDATE ww_games SET phase = ? WHERE guild_id = ?').run('voting', 'guild-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('werewolf', 'guild-1', 'host-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('seer', 'guild-1', 'user-2');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('villager', 'guild-1', 'user-3');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('villager', 'guild-1', 'user-4');

      const votes = [
        { userId: 'host-1', target: 'user-2' },
        { userId: 'user-2', target: 'host-1' },
        { userId: 'user-3', target: 'host-1' },
        { userId: 'user-4', target: 'host-1' },
      ];

      for (const vote of votes) {
        const interaction = createSelectInteraction({
          customId: buildWerewolfVoteId('guild-1'),
          userId: vote.userId,
          values: [vote.target],
          client,
        });
        const handled = await handleWerewolfComponentInteraction(interaction, db);
        expect(handled).toBe(true);
      }

      const gameCount = db.prepare('SELECT COUNT(*) AS count FROM ww_games WHERE guild_id = ?').get('guild-1').count;
      const playerCount = db.prepare('SELECT COUNT(*) AS count FROM ww_players WHERE guild_id = ?').get('guild-1').count;
      expect(gameCount).toBe(0);
      expect(playerCount).toBe(0);

      expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(
        channel.guild.roles.everyone,
        expect.objectContaining({ SendMessages: null }),
      );

      const titles = mainMessage.edit.mock.calls
        .map(([payload]) => payload?.embeds?.[0]?.data?.title)
        .filter((title) => typeof title === 'string');
      expect(titles.some((title) => /Villagers Menang/i.test(title))).toBe(true);
    });

    test('werewolves win removes active game rows and posts werewolf victory state', async () => {
      const { client, mainMessage } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      db.prepare('UPDATE ww_games SET phase = ? WHERE guild_id = ?').run('voting', 'guild-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('werewolf', 'guild-1', 'host-1');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('werewolf', 'guild-1', 'user-2');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('villager', 'guild-1', 'user-3');
      db.prepare('UPDATE ww_players SET role = ? WHERE guild_id = ? AND user_id = ?').run('seer', 'guild-1', 'user-4');

      const votes = [
        { userId: 'host-1', target: 'user-3' },
        { userId: 'user-2', target: 'user-3' },
        { userId: 'user-3', target: 'host-1' },
        { userId: 'user-4', target: 'host-1' },
      ];

      for (const vote of votes) {
        const interaction = createSelectInteraction({
          customId: buildWerewolfVoteId('guild-1'),
          userId: vote.userId,
          values: [vote.target],
          client,
        });
        const handled = await handleWerewolfComponentInteraction(interaction, db);
        expect(handled).toBe(true);
      }

      const gameCount = db.prepare('SELECT COUNT(*) AS count FROM ww_games WHERE guild_id = ?').get('guild-1').count;
      const playerCount = db.prepare('SELECT COUNT(*) AS count FROM ww_players WHERE guild_id = ?').get('guild-1').count;
      expect(gameCount).toBe(0);
      expect(playerCount).toBe(0);

      const titles = mainMessage.edit.mock.calls
        .map(([payload]) => payload?.embeds?.[0]?.data?.title)
        .filter((title) => typeof title === 'string');
      expect(titles.some((title) => /Werewolves Menang/i.test(title))).toBe(true);
    });
  });

  describe('Scenario G: Channel permission transitions', () => {
    test('channel is locked at night, unlocked at day, then locked again when next night starts', async () => {
      const { client, channel } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      const initialLockCalls = channel.permissionOverwrites.edit.mock.calls.filter(
        ([, payload]) => payload?.SendMessages === false,
      );
      expect(initialLockCalls.length).toBeGreaterThan(0);

      const seer = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role = ? LIMIT 1')
        .get('guild-1', 'seer');
      const wolf = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role = ? LIMIT 1')
        .get('guild-1', 'werewolf');
      const seerTarget = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND user_id != ? LIMIT 1')
        .get('guild-1', seer.user_id);
      const wolfTarget = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role != ? AND user_id != ? LIMIT 1')
        .get('guild-1', 'werewolf', seer.user_id);

      await handleWerewolfComponentInteraction(
        createSelectInteraction({
          customId: buildWerewolfNightTargetId('guild-1', 'inspect'),
          userId: seer.user_id,
          values: [seerTarget.user_id],
          client,
        }),
        db,
      );
      await handleWerewolfComponentInteraction(
        createSelectInteraction({
          customId: buildWerewolfNightTargetId('guild-1', 'kill'),
          userId: wolf.user_id,
          values: [wolfTarget.user_id],
          client,
        }),
        db,
      );

      const dayUnlockCalls = channel.permissionOverwrites.edit.mock.calls.filter(
        ([, payload]) => payload?.SendMessages === null,
      );
      expect(dayUnlockCalls.length).toBeGreaterThan(0);

      const forceVoteInteraction = createCommandInteraction({ client, userId: 'host-1' });
      await forceWerewolfVoting(forceVoteInteraction, db);

      const alivePlayers = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND is_alive = 1 ORDER BY joined_at ASC')
        .all('guild-1');
      const votes = [
        { voter: alivePlayers[0].user_id, target: alivePlayers[1].user_id },
        { voter: alivePlayers[1].user_id, target: alivePlayers[2].user_id },
        { voter: alivePlayers[2].user_id, target: alivePlayers[0].user_id },
      ];

      for (const vote of votes) {
        await handleWerewolfComponentInteraction(
          createSelectInteraction({
            customId: buildWerewolfVoteId('guild-1'),
            userId: vote.voter,
            values: [vote.target],
            client,
          }),
          db,
        );
      }

      const allLockCalls = channel.permissionOverwrites.edit.mock.calls.filter(
        ([, payload]) => payload?.SendMessages === false,
      );
      expect(allLockCalls.length).toBeGreaterThan(1);
    });
  });

  describe('Scenario H: DM failure on launch', () => {
    test('launch is rejected when at least one player has closed DMs and phase stays registration', async () => {
      const { client, channel } = createMockClient({ dmFailures: ['user-4'] });
      await startGameAndSeedHost(db, client);
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-2' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-3' });
      joinWerewolfGame(db, { guildId: 'guild-1', userId: 'user-4' });

      const launchInteraction = createButtonInteraction({
        customId: buildWerewolfLaunchId('guild-1'),
        userId: 'host-1',
        client,
      });

      const handled = await handleWerewolfComponentInteraction(launchInteraction, db);

      expect(handled).toBe(true);
      expect(launchInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeral: true,
          content: expect.stringMatching(/DM tertutup/i),
        }),
      );

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game.phase).toBe('registration');

      const nonDefaultRoles = db
        .prepare("SELECT COUNT(*) AS count FROM ww_players WHERE guild_id = ? AND role != 'villager'")
        .get('guild-1').count;
      expect(nonDefaultRoles).toBe(0);

      expect(channel.send).toHaveBeenCalledWith(expect.stringMatching(/belum dimulai karena DM tertutup/i));
    });
  });

  describe('Scenario I: Stale lobby auto-cleanup', () => {
    test('auto-cancels an abandoned lobby after the registration timeout elapses', async () => {
      const { client, mainMessage } = createMockClient();
      await startGameAndSeedHost(db, client);

      await jest.advanceTimersByTimeAsync(WEREWOLF_REGISTRATION_TIMEOUT_MS);

      const game = db.prepare('SELECT * FROM ww_games WHERE guild_id = ?').get('guild-1');
      const players = db.prepare('SELECT * FROM ww_players WHERE guild_id = ?').all('guild-1');
      expect(game).toBeUndefined();
      expect(players).toHaveLength(0);

      const editCalls = mainMessage.edit.mock.calls;
      const lastEditPayload = editCalls[editCalls.length - 1][0];
      expect(lastEditPayload.embeds[0].data.title).toMatch(/lobby ditutup/i);
      expect(lastEditPayload.components).toEqual([]);
    });

    test('does not auto-cancel the lobby once the game has successfully launched', async () => {
      const { client } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      await jest.advanceTimersByTimeAsync(WEREWOLF_REGISTRATION_TIMEOUT_MS);

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game).toBeTruthy();
      expect(game.phase).not.toBe('registration');
    });
  });

  describe('Scenario J: Night phase timeout', () => {
    test('auto-resolves the night phase after the timeout even if not everyone submitted an action', async () => {
      const { client } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      await jest.advanceTimersByTimeAsync(WEREWOLF_NIGHT_ACTION_MS);

      const game = db.prepare('SELECT phase FROM ww_games WHERE guild_id = ?').get('guild-1');
      expect(game.phase).toBe('day');
    });

    // NOTE: This test proves that the manual full-submission resolve path cancels the
    // pending nightTimers entry (via clearGuildTimers -> clearTimeout), so the scheduled
    // setTimeout callback never fires and therefore never re-runs any night/day resolution
    // logic at all. It does NOT exercise resolveNightPhase's own internal
    // `game.phase !== 'night'` guard, because a timer cancelled with clearTimeout never
    // invokes its callback in the first place -- there is no second invocation of
    // resolveNightPhase here for the guard to short-circuit. Reaching that guard branch as
    // "invoked-with-stale-phase-and-correctly-returns-early" would require either exporting
    // the internal `resolveNightPhase` for direct testing, or a black-box mock hook that
    // mutates the DB phase mid-flight through an unrelated internal call (e.g. the
    // `client.guilds.fetch` used by `displayName`) purely to land the write in the right
    // await window -- both were judged out of scope / too fragile for this fix. This is a
    // known, intentionally-flagged test gap, not a claim that the guard is verified.
    test('clears the pending night timer once everyone has already submitted, so the scheduled timeout never fires and never re-runs night/day resolution', async () => {
      const { client, mainMessage } = createMockClient();
      await launchReadyGameWithFourPlayers(db, client);

      const seer = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role = ?')
        .get('guild-1', 'seer');
      const wolf = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role = ?')
        .get('guild-1', 'werewolf');
      const seerTarget = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND user_id != ? LIMIT 1')
        .get('guild-1', seer.user_id);
      const wolfTarget = db
        .prepare('SELECT user_id FROM ww_players WHERE guild_id = ? AND role != ? AND user_id != ? LIMIT 1')
        .get('guild-1', 'werewolf', seer.user_id);

      await handleWerewolfComponentInteraction(
        createSelectInteraction({
          customId: buildWerewolfNightTargetId('guild-1', 'inspect'),
          userId: seer.user_id,
          values: [seerTarget.user_id],
          client,
        }),
        db,
      );
      await handleWerewolfComponentInteraction(
        createSelectInteraction({
          customId: buildWerewolfNightTargetId('guild-1', 'kill'),
          userId: wolf.user_id,
          values: [wolfTarget.user_id],
          client,
        }),
        db,
      );

      // The manual full-submission resolve above already ran resolveNightPhase once,
      // which produced exactly one DAY embed edit.
      const dayEditsBefore = mainMessage.edit.mock.calls.filter(
        ([payload]) => payload?.embeds?.[0]?.data?.title?.includes('DAY'),
      ).length;
      expect(dayEditsBefore).toBe(1);

      // That same resolve call cleared this guild's nightTimers entry via clearGuildTimers,
      // so the setTimeout scheduled in startNightPhase was removed from Node's timer queue
      // before it could fire. Advancing fake timers past its original delay should therefore
      // invoke no callback at all for this guild -- not "invoke it and have it correctly no-op".
      await jest.advanceTimersByTimeAsync(WEREWOLF_NIGHT_ACTION_MS);

      const dayEditsAfter = mainMessage.edit.mock.calls.filter(
        ([payload]) => payload?.embeds?.[0]?.data?.title?.includes('DAY'),
      ).length;
      expect(dayEditsAfter).toBe(1);
    });
  });
});
