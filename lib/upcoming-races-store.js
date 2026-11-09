'use client';

/**
 * Shared upcoming-races store.
 *
 * Single adaptive poll of /api/races/upcoming with hold-until-full-set
 * logic, consumed by both NavShell's countdown bar and the dashboard's
 * Live Race Feed via useUpcomingRaces().
 *
 * Why this exists: the cron creates a user's pending races sequentially
 * per pair, so a 15s poll can land mid-insert and return e.g. 1 race
 * before the full set of 3 has been written. Each consumer used to
 * solve this independently (NavShell with its own ref, dashboard
 * without — which is why the dashboard live feed could show the user
 * with only 1 of their 3 upcoming races for up to 30s after each
 * cycle). The shared store does it once.
 *
 * Polling cadence:
 *   - 15s steady when the latest poll committed (count is stable or
 *     matches activeDroneCount).
 *   - 3s when the latest poll caught a partial set; we hold the prior
 *     displayed list and fast-poll until either the count stabilises
 *     or hits activeDroneCount.
 *
 * Polling only runs while at least one subscriber is mounted. Module-
 * scoped state survives SPA navigations, so a remounted consumer
 * hydrates instantly from the last committed snapshot - no flash of
 * empty rows.
 *
 * Snapshot shape (referentially stable when unchanged):
 *   { races: PendingRace[], activeDroneCount: number | null }
 */

import { useSyncExternalStore } from 'react';
import { noteServerDate } from '@/lib/client/server-clock';

const SLOW_MS = 15_000;
const FAST_MS = 3_000;

const listeners = new Set();
let pollTimer = null;
let lastFetchedCount = null;
let snapshot = { races: [], activeDroneCount: null };

function notify() {
  for (const l of listeners) l();
}

function commitState(newRaces, newCount) {
  if (snapshot.races !== newRaces || snapshot.activeDroneCount !== newCount) {
    snapshot = { races: newRaces, activeDroneCount: newCount };
    notify();
  }
}

async function pollOnce() {
  let nextDelay = SLOW_MS;
  try {
    const res = await fetch('/api/races/upcoming');
    noteServerDate(res.headers.get('date'));
    if (res.status === 401) {
      // Not signed in - back off to slow polling so a sign-in picks up
      // promptly without burning requests.
      return SLOW_MS;
    }
    const body = await res.json();
    if (res.ok && body?.data) {
      const newRaces = body.data.races ?? [];
      const expected = body.data.activeDroneCount ?? null;
      const prev = lastFetchedCount;
      lastFetchedCount = newRaces.length;
      // Always commit when the round is empty (transitioning to '--'),
      // when the full expected set has landed, or when the count has
      // stabilised across two polls. Otherwise we caught the cron
      // mid-creation - hold the prior display + fast-poll.
      const shouldCommit =
        newRaces.length === 0 ||
        (expected != null && newRaces.length >= expected) ||
        newRaces.length === prev;
      if (shouldCommit) {
        commitState(newRaces, expected);
      } else {
        nextDelay = FAST_MS;
      }
    }
  } catch {
    // network blip - keep stale snapshot, just reschedule
  }
  return nextDelay;
}

async function pollLoop() {
  const delay = await pollOnce();
  pollTimer = setTimeout(pollLoop, delay);
}

function startPolling() {
  if (pollTimer) return;
  pollLoop();
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return snapshot;
}

/**
 * @returns {{ races: Array<object>, activeDroneCount: number | null }}
 */
export function useUpcomingRaces() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
