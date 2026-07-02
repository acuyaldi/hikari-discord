import type Database from 'better-sqlite3';
import type {
  WerewolfGameRow,
  WerewolfPhase,
  WerewolfPlayerRow,
  WerewolfRoleAssignment,
} from './types';

function mapGame(row: Record<string, unknown> | undefined): WerewolfGameRow | null {
  if (!row) return null;
  return row as unknown as WerewolfGameRow;
}

function mapPlayers(rows: Record<string, unknown>[]): WerewolfPlayerRow[] {
  return rows as unknown as WerewolfPlayerRow[];
}

export function createWerewolfGame(
  db: Database.Database,
  input: { guildId: string; channelId: string; hostUserId: string; messageId?: string | null; now?: number },
): void {
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO ww_games (
      guild_id, channel_id, host_user_id, phase, message_id, day_message_id,
      phase_started_at, registration_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'registration', ?, NULL, ?, ?, ?, ?)` ,
  ).run(
    input.guildId,
    input.channelId,
    input.hostUserId,
    input.messageId ?? null,
    now,
    now,
    now,
    now,
  );

  db.prepare('DELETE FROM ww_players WHERE guild_id = ?').run(input.guildId);
}

export function getWerewolfGame(db: Database.Database, guildId: string): WerewolfGameRow | null {
  const row = db.prepare('SELECT * FROM ww_games WHERE guild_id = ?').get(guildId) as Record<string, unknown> | undefined;
  return mapGame(row);
}

export function deleteWerewolfGame(db: Database.Database, guildId: string): void {
  db.prepare('DELETE FROM ww_players WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM ww_games WHERE guild_id = ?').run(guildId);
}

export function setWerewolfGameMessageId(
  db: Database.Database,
  guildId: string,
  messageId: string,
  now = Date.now(),
): void {
  db.prepare('UPDATE ww_games SET message_id = ?, updated_at = ? WHERE guild_id = ?').run(messageId, now, guildId);
}

export function setWerewolfPhase(
  db: Database.Database,
  guildId: string,
  phase: WerewolfPhase,
  now = Date.now(),
): void {
  db.prepare('UPDATE ww_games SET phase = ?, phase_started_at = ?, updated_at = ? WHERE guild_id = ?').run(
    phase,
    now,
    now,
    guildId,
  );
}

export function claimWerewolfLaunch(db: Database.Database, guildId: string, now = Date.now()): boolean {
  const result = db.prepare(
    'UPDATE ww_games SET phase = ?, phase_started_at = ?, updated_at = ? WHERE guild_id = ? AND phase = ?',
  ).run('launching', now, now, guildId, 'registration');
  return result.changes === 1;
}

export function joinWerewolfGame(
  db: Database.Database,
  input: { guildId: string; userId: string; now?: number },
): void {
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO ww_players (
      guild_id, user_id, role, is_alive, voted_for, dm_channel_id, night_target_user_id, last_action_at, joined_at
    ) VALUES (?, ?, 'villager', 1, NULL, NULL, NULL, NULL, ?)
    ON CONFLICT(guild_id, user_id) DO NOTHING`,
  ).run(input.guildId, input.userId, now);
}

export function listWerewolfPlayers(db: Database.Database, guildId: string): WerewolfPlayerRow[] {
  const rows = db.prepare('SELECT * FROM ww_players WHERE guild_id = ? ORDER BY joined_at ASC').all(guildId) as Record<string, unknown>[];
  return mapPlayers(rows);
}

export function listAliveWerewolfPlayers(db: Database.Database, guildId: string): WerewolfPlayerRow[] {
  const rows = db.prepare('SELECT * FROM ww_players WHERE guild_id = ? AND is_alive = 1 ORDER BY joined_at ASC').all(guildId) as Record<string, unknown>[];
  return mapPlayers(rows);
}

export function getWerewolfPlayer(
  db: Database.Database,
  guildId: string,
  userId: string,
): WerewolfPlayerRow | null {
  const row = db.prepare('SELECT * FROM ww_players WHERE guild_id = ? AND user_id = ?').get(guildId, userId) as Record<string, unknown> | undefined;
  return row ? (row as unknown as WerewolfPlayerRow) : null;
}

export function assignWerewolfRoles(
  db: Database.Database,
  guildId: string,
  assignments: WerewolfRoleAssignment[],
): void {
  const statement = db.prepare('UPDATE ww_players SET role = ?, is_alive = 1, voted_for = NULL, night_target_user_id = NULL WHERE guild_id = ? AND user_id = ?');
  const transaction = db.transaction((rows: WerewolfRoleAssignment[]) => {
    for (const assignment of rows) {
      statement.run(assignment.role, guildId, assignment.userId);
    }
  });
  transaction(assignments);
}

export function setWerewolfPlayerDmChannel(
  db: Database.Database,
  guildId: string,
  userId: string,
  dmChannelId: string,
): void {
  db.prepare('UPDATE ww_players SET dm_channel_id = ? WHERE guild_id = ? AND user_id = ?').run(dmChannelId, guildId, userId);
}

export function setWerewolfNightTarget(
  db: Database.Database,
  guildId: string,
  userId: string,
  targetUserId: string,
  now = Date.now(),
): void {
  db.prepare('UPDATE ww_players SET night_target_user_id = ?, last_action_at = ? WHERE guild_id = ? AND user_id = ?').run(
    targetUserId,
    now,
    guildId,
    userId,
  );
}

export function clearWerewolfNightTargets(db: Database.Database, guildId: string): void {
  db.prepare('UPDATE ww_players SET night_target_user_id = NULL, last_action_at = NULL WHERE guild_id = ?').run(guildId);
}

export function setWerewolfVote(
  db: Database.Database,
  guildId: string,
  userId: string,
  targetUserId: string,
  now = Date.now(),
): void {
  db.prepare('UPDATE ww_players SET voted_for = ?, last_action_at = ? WHERE guild_id = ? AND user_id = ?').run(
    targetUserId,
    now,
    guildId,
    userId,
  );
}

export function clearWerewolfVotes(db: Database.Database, guildId: string): void {
  db.prepare('UPDATE ww_players SET voted_for = NULL WHERE guild_id = ?').run(guildId);
}

export function setWerewolfAliveStatus(
  db: Database.Database,
  guildId: string,
  userId: string,
  isAlive: boolean,
): void {
  db.prepare('UPDATE ww_players SET is_alive = ? WHERE guild_id = ? AND user_id = ?').run(isAlive ? 1 : 0, guildId, userId);
}
