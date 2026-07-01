import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkCooldown,
  clearCooldowns,
  COOLDOWN_TIME,
} from '../src/utils/cooldown';

function withMockedNow<T>(value: number | (() => number), run: () => T): T {
  const originalNow = Date.now;
  Date.now = typeof value === 'function' ? value : () => value;
  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

test('first request from a user is allowed', () => {
  clearCooldowns();

  const blocked = withMockedNow(1_000, () => checkCooldown('user-first'));

  assert.equal(blocked, false);
});

test('immediate second request from same user is blocked', () => {
  clearCooldowns();

  withMockedNow(1_000, () => checkCooldown('user-repeat'));
  const blocked = withMockedNow(1_001, () => checkCooldown('user-repeat'));

  assert.equal(blocked, true);
});

test('request after cooldown duration elapsed is allowed', () => {
  clearCooldowns();

  withMockedNow(1_000, () => checkCooldown('user-elapsed'));
  const blocked = withMockedNow(1_000 + COOLDOWN_TIME, () => checkCooldown('user-elapsed'));

  assert.equal(blocked, false);
});

test('different users have independent cooldowns', () => {
  clearCooldowns();

  withMockedNow(1_000, () => checkCooldown('user-a'));
  const blocked = withMockedNow(1_001, () => checkCooldown('user-b'));

  assert.equal(blocked, false);
});

test('internal cooldown errors fail open', () => {
  clearCooldowns();

  const blocked = withMockedNow(() => {
    throw new Error('clock failed');
  }, () => checkCooldown('user-error'));

  assert.equal(blocked, false);
});
