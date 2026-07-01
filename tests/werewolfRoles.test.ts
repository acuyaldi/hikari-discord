/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { assignRoles, evaluateWinCondition, getRolePlan, tallyVotes } from '../src/services/werewolf/roles';
import type { WerewolfPlayerRow } from '../src/services/werewolf/types';

function player(overrides: Partial<WerewolfPlayerRow>): WerewolfPlayerRow {
  return {
    guild_id: 'guild-1',
    user_id: 'user-1',
    role: 'villager',
    is_alive: 1,
    voted_for: null,
    dm_channel_id: null,
    night_target_user_id: null,
    last_action_at: null,
    joined_at: 1,
    ...overrides,
  };
}

test('getRolePlan assigns one seer and one werewolf at four players', () => {
  assert.deepEqual(getRolePlan(4).sort(), ['seer', 'villager', 'villager', 'werewolf'].sort());
});

test('getRolePlan assigns two werewolves at seven players', () => {
  const roles = getRolePlan(7);
  assert.equal(roles.filter((role) => role === 'werewolf').length, 2);
  assert.equal(roles.filter((role) => role === 'seer').length, 1);
  assert.equal(roles.length, 7);
});

test('assignRoles returns one role per user', () => {
  const assignments = assignRoles(['a', 'b', 'c', 'd'], () => 0.4);
  assert.equal(assignments.length, 4);
  assert.deepEqual(assignments.map((assignment) => assignment.userId).sort(), ['a', 'b', 'c', 'd']);
});

test('evaluateWinCondition returns villagers when all werewolves are dead', () => {
  const result = evaluateWinCondition([
    player({ user_id: 'seer', role: 'seer', is_alive: 1 }),
    player({ user_id: 'villager', role: 'villager', is_alive: 1 }),
    player({ user_id: 'wolf', role: 'werewolf', is_alive: 0 }),
  ]);

  assert.equal(result, 'villagers');
});

test('evaluateWinCondition returns werewolves when parity is reached', () => {
  const result = evaluateWinCondition([
    player({ user_id: 'wolf', role: 'werewolf', is_alive: 1 }),
    player({ user_id: 'villager', role: 'villager', is_alive: 1 }),
  ]);

  assert.equal(result, 'werewolves');
});

test('tallyVotes returns null on a tie', () => {
  const result = tallyVotes([
    player({ user_id: 'a', voted_for: 'x' }),
    player({ user_id: 'b', voted_for: 'y' }),
  ]);

  assert.equal(result.targetUserId, null);
  assert.equal(result.tie, true);
});

test('tallyVotes returns the top target when votes are decisive', () => {
  const result = tallyVotes([
    player({ user_id: 'a', voted_for: 'x' }),
    player({ user_id: 'b', voted_for: 'x' }),
    player({ user_id: 'c', voted_for: 'y' }),
  ]);

  assert.equal(result.targetUserId, 'x');
  assert.equal(result.tie, false);
});