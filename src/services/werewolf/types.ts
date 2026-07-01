export type WerewolfPhase = 'registration' | 'night' | 'day' | 'voting';

export type WerewolfRole = 'villager' | 'werewolf' | 'seer';

export type WerewolfVictory = 'villagers' | 'werewolves';

export interface WerewolfGameRow {
  guild_id: string;
  channel_id: string;
  host_user_id: string;
  phase: WerewolfPhase;
  message_id: string | null;
  day_message_id: string | null;
  phase_started_at: number | null;
  registration_started_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface WerewolfPlayerRow {
  guild_id: string;
  user_id: string;
  role: WerewolfRole;
  is_alive: number;
  voted_for: string | null;
  dm_channel_id: string | null;
  night_target_user_id: string | null;
  last_action_at: number | null;
  joined_at: number;
}

export interface WerewolfRoleAssignment {
  userId: string;
  role: WerewolfRole;
}