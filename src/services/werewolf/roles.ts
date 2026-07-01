import type {
  WerewolfPlayerRow,
  WerewolfRole,
  WerewolfRoleAssignment,
  WerewolfVictory,
} from './types';

function shuffle<T>(values: T[]): T[] {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function getRolePlan(playerCount: number): WerewolfRole[] {
  if (playerCount < 4) {
    throw new Error('Werewolf requires at least 4 players');
  }

  const werewolfCount = playerCount >= 7 ? 2 : 1;
  const roles: WerewolfRole[] = ['seer'];

  for (let index = 0; index < werewolfCount; index += 1) {
    roles.push('werewolf');
  }

  while (roles.length < playerCount) {
    roles.push('villager');
  }

  return roles;
}

export function assignRoles(userIds: string[], random = Math.random): WerewolfRoleAssignment[] {
  if (userIds.length < 4) {
    throw new Error('Werewolf requires at least 4 players');
  }

  const users = userIds.slice();
  for (let index = users.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [users[index], users[swapIndex]] = [users[swapIndex], users[index]];
  }

  const plan = shuffle(getRolePlan(userIds.length));
  return users.map((userId, index) => ({ userId, role: plan[index] ?? 'villager' }));
}

export function evaluateWinCondition(players: WerewolfPlayerRow[]): WerewolfVictory | null {
  const alivePlayers = players.filter((player) => player.is_alive === 1);
  const aliveWerewolves = alivePlayers.filter((player) => player.role === 'werewolf').length;
  const aliveVillagerSide = alivePlayers.filter((player) => player.role !== 'werewolf').length;

  if (aliveWerewolves === 0) return 'villagers';
  if (aliveWerewolves >= aliveVillagerSide) return 'werewolves';
  return null;
}

export function tallyVotes(players: WerewolfPlayerRow[]): { targetUserId: string | null; tie: boolean } {
  const alivePlayers = players.filter((player) => player.is_alive === 1);
  const voteCounts = new Map<string, number>();

  for (const player of alivePlayers) {
    if (player.voted_for === null) continue;
    voteCounts.set(player.voted_for, (voteCounts.get(player.voted_for) ?? 0) + 1);
  }

  let winningTarget: string | null = null;
  let highestVotes = 0;
  let tie = false;

  for (const [targetUserId, votes] of voteCounts.entries()) {
    if (votes > highestVotes) {
      winningTarget = targetUserId;
      highestVotes = votes;
      tie = false;
      continue;
    }

    if (votes === highestVotes) {
      tie = true;
    }
  }

  return {
    targetUserId: tie ? null : winningTarget,
    tie,
  };
}