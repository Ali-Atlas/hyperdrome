'use client';

/**
 * Global race-round clock.
 *
 * Single shared poll of /api/races/next (the same endpoint NavShell's
 * countdown bar uses). Tracks two derived values components can read
 * without each maintaining their own polling loop:
 *
 *   useRacingInProgress() -> boolean
 *     true while the cron is finalizing the previous round and
 *     scheduling the next one (i.e. the visible "RACING IN PROGRESS"
 *     window). Drone pages disable the active/inactive toggle while
 *     this is true so the user can't fire a toggle into a
 *     mid-transition system.
 *
 *   useRoundStartTick() -> number
 *     monotonically-increasing counter that bumps the moment racing
 *     transitions from true -> false. That moment IS "the new round
 *     just started" - matchmaking has run, the new pending races are
 *     visible, the previous round's pending toggles can resolve.
 *     Pages list it as a useEffect dep to refetch their data + clear
 *     pending entries when it changes.
 *
 * Polling is adaptive: 2s whenever the countdown is within 30s of
 * zero OR already past zero (covers the entire cron processing
 * window), 30s otherwise. So the round-start tick fires within ~2s
 * of the server completing the cycle without flooding the network
 * during the comfortable middle of a round. Polling only runs while
 * at least one subscriber is mounted.
 *
 * NavShell maintains its own independent poll of the same endpoint -
 * not consolidated to avoid touching working code. The duplicate
 * cost is one tiny GET per 2-30s, acceptable.
 */

import { useSyncExternalStore } from 'react';

const POLL_FAST_MS = 2_000;
const POLL_SLOW_MS = 30_000;
/* Aggressive-poll window: when the countdown drops below this many
   milliseconds from zero (or is already past zero), drop the poll
   cadence to FAST_MS so we catch the racing-in-progress flip and the
   subsequent round-start tick within 2-3s of the server. Outside
   this window we slow-poll at SLOW_MS to keep the network quiet. */
const FAST_POLL_WINDOW_MS = 30_000;

const listeners = new Set();
let pollTimer = null;
let secondTimer = null;

let batchAt = null;
let paused = false;
let racingInProgress = false;
let roundStartTick = 0;

function notify() {
  for (const l of listeners) l();
}

function applyState(newBatchAt, newPaused) {
  let changed = false;
  if (newBatchAt !== batchAt || newPaused !== paused) {
    batchAt = newBatchAt;
    paused = newPaused;
    changed = true;
  }
  const newRacing =
    !paused && batchAt != null && batchAt <= Date.now();
  if (newRacing !== racingInProgress) {
    // racing -> not racing = the cron just finished, the new round
    // is locked in, and matchmaking has consumed any pending toggles.
    if (racingInProgress && !newRacing) {
      roundStartTick += 1;
    }
    racingInProgress = newRacing;
    changed = true;
  }
  if (changed) notify();
}

async function pollOnce() {
  let nextBatchAt = batchAt;
  let nextPaused = paused;
  try {
    const res = await fetch('/api/races/next');
    if (res.ok) {
      const body = await res.json();
      if (body?.data?.paused) {
        nextPaused = true;
      } else if (body?.data) {
        nextPaused = false;
        nextBatchAt = body.data.nextRaceAt
          ? new Date(body.data.nextRaceAt).getTime()
          : null;
      }
    }
  } catch {
    /* network blip - keep last-known state, just reschedule */
  }
  applyState(nextBatchAt, nextPaused);
}

async function pollLoop() {
  await pollOnce();
  // Schedule the next poll relative to the now-current batchAt:
  //   - remaining > FAST_POLL_WINDOW_MS: slow-poll. Land at the
  //     boundary of the fast-poll window (or SLOW_MS, whichever is
  //     sooner) so the very next poll arrives in the aggressive
  //     window, not 30s into it.
  //   - remaining inside the fast window OR already past expiry:
  //     fast-poll every FAST_MS so the racing-in-progress flip and
  //     subsequent round-start tick fire within 2-3s of the server.
  const remaining = batchAt != null ? batchAt - Date.now() : 0;
  let delay;
  if (remaining > FAST_POLL_WINDOW_MS) {
    delay = Math.min(remaining - FAST_POLL_WINDOW_MS, POLL_SLOW_MS);
  } else {
    delay = POLL_FAST_MS;
  }
  pollTimer = setTimeout(pollLoop, delay);
}

function tickSeconds() {
  // Keep racingInProgress derivation honest at second-granularity.
  // The poll loop also re-derives, but the second-ticker handles the
  // boundary precisely (at the moment batchAt elapses, we want
  // racingInProgress to flip without waiting for the next poll).
  applyState(batchAt, paused);
}

function startPolling() {
  if (pollTimer || secondTimer) return;
  pollLoop();
  secondTimer = setInterval(tickSeconds, 1000);
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  if (secondTimer) clearInterval(secondTimer);
  pollTimer = null;
  secondTimer = null;
  // Reset state so the next subscriber starts from a clean slate.
  batchAt = null;
  paused = false;
  racingInProgress = false;
  // Note: `roundStartTick` deliberately NOT reset - it's a
  // monotonic counter; resetting would let stale `useEffect`
  // dep comparisons fire spuriously when a subscriber re-mounts.
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

export function useRacingInProgress() {
  return useSyncExternalStore(
    subscribe,
    () => racingInProgress,
    () => false,
  );
}

export function useRoundStartTick() {
  return useSyncExternalStore(
    subscribe,
    () => roundStartTick,
    () => 0,
  );
}
