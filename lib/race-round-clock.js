'use client';

/**
 * Global race-round-end clock.
 *
 * Single shared poll of /api/races/upcoming (15s, only while at least
 * one component is subscribed via `useRaceRoundEnd`). Every poll, we
 * compare the current pending-race id set against the previous poll's
 * snapshot - any id that disappeared means that race completed
 * server-side and the round it belonged to is over. We bump a tick
 * counter and notify subscribers; their `useEffect`s re-run and
 * refetch their own page data.
 *
 * Why "id disappeared from upcoming" is the right signal:
 *   - upcoming list = races with status === 'pending'
 *   - the race cron flips a race's status from 'pending' to 'completed'
 *     ONLY after the simulation has fully run
 *   - so a race leaving the upcoming list = the round actually ended,
 *     not just started
 *
 * This is the only reliable client-side signal without server-push.
 * Captain hates polling but the minimum infrastructure to detect a
 * server event is one shared interval - everything else (per-page
 * setIntervals, chained one-shot timers tied to scheduledAt) was
 * either redundant or fired at the wrong moment.
 */

import { useSyncExternalStore } from 'react';

const POLL_MS = 15_000;

const listeners = new Set();
let timer = null;
let knownRaceIds = null;
let roundEndTick = 0;

function notify() {
  for (const l of listeners) l();
}

async function pollOnce() {
  try {
    const res = await fetch('/api/races/upcoming');
    if (!res.ok) return;
    const body = await res.json();
    const races = body?.data?.races ?? [];
    const ids = new Set(races.map((r) => r.id));
    if (knownRaceIds !== null) {
      // Any previously-pending race that's no longer pending means
      // its round just ended. One bump per poll is enough - all
      // subscribers refetch the same way regardless of how many
      // races completed in the same cycle.
      let someDisappeared = false;
      for (const prevId of knownRaceIds) {
        if (!ids.has(prevId)) {
          someDisappeared = true;
          break;
        }
      }
      if (someDisappeared) {
        roundEndTick += 1;
        notify();
      }
    }
    knownRaceIds = ids;
  } catch {
    /* swallow transient failures - next tick retries */
  }
}

function startPolling() {
  if (timer) return;
  // Immediate baseline poll so subscribers don't wait 15s for the
  // first knownRaceIds snapshot to land.
  pollOnce();
  timer = setInterval(pollOnce, POLL_MS);
}

function stopPolling() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  // Reset baseline so the next subscriber doesn't compare against
  // a stale snapshot from a previous mount.
  knownRaceIds = null;
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

/**
 * Returns a monotonically-increasing tick counter that bumps every
 * time the polling loop detects at least one race finishing
 * server-side (i.e. a race round ended). Components use it as a
 * `useEffect` dep to trigger their own refresh:
 *
 *     const roundTick = useRaceRoundEnd();
 *     useEffect(() => {
 *       if (roundTick > 0) refresh();
 *     }, [roundTick, refresh]);
 *
 * Skip the `> 0` guard if you want the initial mount to refresh too;
 * usually you don't because the page already fetches on mount.
 */
export function useRaceRoundEnd() {
  return useSyncExternalStore(subscribe, () => roundEndTick, () => 0);
}
