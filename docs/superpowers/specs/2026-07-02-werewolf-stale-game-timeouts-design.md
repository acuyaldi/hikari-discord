# Werewolf Stale Game Timeouts — Design

## Problem

`/werewolf` games can get stuck forever with no way to recover:

1. **Registration lobby abandoned.** A host runs `/werewolf start` and then leaves the
   server (or simply never clicks Start Game). `/werewolf stop` and the Launch button
   both require `interaction.user.id === game.host_user_id`, so nobody else can clear
   the lobby. Since only one active game per guild is allowed
   (`startWerewolfRegistration` rejects a second `/werewolf start` while a game row
   exists), this permanently blocks new games in that guild.
2. **Night phase stuck.** `startNightPhase` sends DMs to werewolves/seer and waits for
   `allNightActionsSubmitted()` to trigger `resolveNightPhase`. Unlike the day and
   voting phases (`dayTimers`, `voteTimers`), there is no timer that force-advances the
   night phase. If a werewolf or the seer goes AFK or leaves without acting, the game
   is stuck in `night` indefinitely, with the same "only the host can `/werewolf stop`"
   escape hatch as above.

## Goals

- Auto-cancel a registration lobby after 10 minutes of no `Start Game` click.
- Auto-advance the night phase after 60 seconds if not everyone has submitted an
  action, using whatever actions were submitted (consistent with how the existing
  voting timeout already handles partial participation).
- No change to any existing Discord-facing text, slash commands, DB schema, or role
  logic. This is additive: new timers plus one new "lobby expired" message.

## Non-goals

- Persisting timers across bot restarts (existing `dayTimers`/`voteTimers` already
  don't survive a restart; this fix doesn't change that risk profile).
- Allowing non-hosts to manually force-stop a game (`/werewolf stop` staying
  host-only is unchanged) — the timeout is the recovery path instead.
- Any change to how villagers, werewolves, or the seer act during a live night phase.

## Design

### 1. Registration lobby timeout (10 minutes, not reset on join)

- New constant in `ui.ts`: `WEREWOLF_REGISTRATION_TIMEOUT_MS = 10 * 60_000`.
- New constant/embed in `ui.ts`: `createLobbyExpiredEmbed()` — a short embed saying the
  lobby was closed for inactivity, no players/roles are shown (there's nothing
  sensitive to hide at this phase).
- New `Map<string, NodeJS.Timeout>` in `game.ts`: `registrationTimers`.
- New helpers in `game.ts`:
  - `armRegistrationTimeout(client, db, guildId)` — clears any existing entry, then
    schedules `autoCancelStaleLobby(client, db, guildId)` after
    `WEREWOLF_REGISTRATION_TIMEOUT_MS`.
  - `clearRegistrationTimeout(guildId)` — clears the map entry (mirrors
    `clearPendingLaunch`).
  - `autoCancelStaleLobby(client, db, guildId)` — re-fetches the game; if it's gone or
    no longer in `registration` phase, no-op (already handled elsewhere). Otherwise:
    edit the main lobby message to `createLobbyExpiredEmbed()` with no components, then
    `deleteWerewolfGame(db, guildId)`.
- Timer lifecycle:
  - Armed at the end of `startWerewolfRegistration` (lobby just opened).
  - Re-armed inside `handleLaunch`'s DM-failure branch, right after
    `setWerewolfPhase(db, guildId, 'registration')` — the lobby is live again and gets
    a fresh window.
  - Cleared in `handleLaunch` immediately after `claimWerewolfLaunch` succeeds (game is
    leaving `registration` for real).
  - Cleared in `finishWerewolfGame` (covers `/werewolf stop` and both win conditions).
- Per the approved Q&A: the 10-minute window is fixed from lobby creation and is **not**
  reset when new players join — only re-armed on a failed-launch → registration
  bounce-back, since that's a genuine new "lobby is open" state.

### 2. Night phase timeout (60 seconds)

- New constant in `ui.ts`: `WEREWOLF_NIGHT_ACTION_MS = 60_000` (same value as
  `WEREWOLF_VOTE_MS`, kept as a separate named constant since it governs a different
  phase and may need to diverge later).
- New `Map<string, NodeJS.Timeout>` in `game.ts`: `nightTimers`.
- `startNightPhase` schedules `resolveNightPhase(client, db, guildId)` after
  `WEREWOLF_NIGHT_ACTION_MS`, stored in `nightTimers`, mirroring how
  `startVotingPhase` schedules `resolveVotingPhase` via `voteTimers`.
- `clearGuildTimers(guildId)` is extended to also clear `nightTimers` (it already
  clears `dayTimers` and `voteTimers`), so every existing call site that resets timers
  on phase transitions automatically covers the new timer too — no new call sites
  needed beyond the one in `startNightPhase` itself.
- **Double-resolve guard:** `resolveNightPhase` currently has no early-exit check. Add
  this at its top, before doing anything else:

  ```ts
  const game = getWerewolfGame(db, guildId);
  if (!game || game.phase !== 'night') return;
  ```

  `startDayPhase` already calls
  `clearGuildTimers(guildId)` right before scheduling its own `dayTimers` entry (and,
  on the win-condition branch, `finishWerewolfGame` also calls `clearGuildTimers`).
  Once `clearGuildTimers` is extended to include `nightTimers`, both of those existing
  call sites automatically cancel any pending night timer as soon as the night phase
  resolves — the phase guard above only needs to catch the narrow race where the timer
  was already queued to run before that clear happened.
- No change to `chooseNightVictim`, `allNightActionsSubmitted`, or any DM/embed
  content — partial-submission handling already falls out of existing logic (a wolf
  who didn't vote simply contributes no tally entry; a seer who didn't act simply gets
  no result, same as if they'd chosen not to act and the game moved on).

## Data flow summary

```text
/werewolf start ──► armRegistrationTimeout ──(10 min, no launch)──► autoCancelStaleLobby ──► lobby message edited + game deleted
       │
       └─ Start Game clicked ──► claimWerewolfLaunch ok ──► clearRegistrationTimeout
                                        │
                                        ├─ DM failure ──► phase back to 'registration' ──► armRegistrationTimeout (re-armed)
                                        │
                                        └─ success ──► startNightPhase ──► nightTimers.set ──(60s, not all submitted)──► resolveNightPhase (guarded) ──► startDayPhase
                                                                                   │
                                                                                   └─ all submitted early ──► resolveNightPhase (guarded, timer becomes no-op)
```

## Testing plan

Using `jest.useFakeTimers()` in `tests/werewolf-registration.test.js`:

1. **Lobby timeout:** open a lobby, advance fake timers by 10 minutes without anyone
   launching → assert `ww_games`/`ww_players` rows for the guild are gone and the main
   message was edited with the expired-lobby embed.
2. **Lobby timeout does not fire after successful launch:** open a lobby, launch
   successfully with 4 players, advance fake timers by 10 minutes → assert the game
   row still exists (now in `night` phase), i.e. the registration timer was properly
   cleared on launch.
3. **Night timeout:** launch a 4-player game, have only some (not all) night actors
   submit, advance fake timers by 60 seconds → assert phase becomes `day` and the
   correct victim (or no-victim message) is derived from just the submitted actions.
4. **Night timeout does not double-resolve:** launch a game, have all night actors
   submit (triggering immediate manual resolution), then advance fake timers by 60
   seconds anyway → assert `resolveNightPhase`'s side effects (day phase transition,
   win-condition check) only happened once (e.g. main message `edit` call count for the
   day-phase embed is 1, not 2).

Existing tests (Scenario D, G) must continue passing unchanged, since they exercise
the manual/early-resolution path that the guard is designed to keep working.
