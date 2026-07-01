/// <reference types="node" />

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import test from 'node:test';

import {
  assignWerewolfRoles,
  createWerewolfGame,
  getWerewolfGame,
  joinWerewolfGame,
  listWerewolfPlayers,
  setWerewolfPhase,
} from '../src/services/werewolf/store';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE ww_games (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      host_user_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      message_id TEXT,
      day_message_id TEXT,
      phase_started_at INTEGER,
      registration_started_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  db.prepare(`
    CREATE TABLE ww_players (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'villager',
      is_alive INTEGER NOT NULL DEFAULT 1,
      voted_for TEXT,
      dm_channel_id TEXT,
      night_target_user_id TEXT,
      last_action_at INTEGER,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `).run();
  return db;
}

test('createWerewolfGame stores registration phase metadata', () => {
  const db = createDb();
  try {
    createWerewolfGame(db, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      hostUserId: 'host-1',
      messageId: 'message-1',
      now: 123,
    });

    const game = getWerewolfGame(db, 'guild-1');
    assert.notEqual(game, null);
    assert.equal(game?.phase, 'registration');
    assert.equal(game?.message_id, 'message-1');
  } finally {
    db.close();
  }
});

test('joinWerewolfGame ignores duplicate joins and assignWerewolfRoles persists roles', () => {
  const db = createDb();
  try {
    createWerewolfGame(db, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      hostUserId: 'host-1',
    });
    joinWerewolfGame(db, { guildId: 'guild-1', userId: 'a', now: 1 });
    joinWerewolfGame(db, { guildId: 'guild-1', userId: 'a', now: 2 });
    joinWerewolfGame(db, { guildId: 'guild-1', userId: 'b', now: 3 });

    assignWerewolfRoles(db, 'guild-1', [
      { userId: 'a', role: 'seer' },
      { userId: 'b', role: 'werewolf' },
    ]);

    const players = listWerewolfPlayers(db, 'guild-1');
    assert.equal(players.length, 2);
    assert.equal(players.find((player) => player.user_id === 'a')?.role, 'seer');
    assert.equal(players.find((player) => player.user_id === 'b')?.role, 'werewolf');
  } finally {
    db.close();
  }
});

test('setWerewolfPhase updates the current game phase', () => {
  const db = createDb();
  try {
    createWerewolfGame(db, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      hostUserId: 'host-1',
      now: 10,
    });
    setWerewolfPhase(db, 'guild-1', 'night', 20);

    const game = getWerewolfGame(db, 'guild-1');
    assert.equal(game?.phase, 'night');
    assert.equal(game?.phase_started_at, 20);
  } finally {
    db.close();
  }
});