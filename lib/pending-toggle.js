'use client';

/**
 * Session-wide pending-toggle state for drone active/inactive flips.
 *
 * The DB write is immediate, but matchmaking only reshuffles at the
 * next race cron tick - so the user's most-recent active toggle
 * doesn't actually take effect until the next cycle. The badges in
 * the UI shouldn't flip the moment the user clicks; they should keep
 * showing the *previous* state with a small "(pending)" hint until
 * the page is refreshed (when, by then, the next race cycle has
 * usually run).
 *
 * Pending state lives in a module-scoped Map. It survives Next.js
 * SPA route changes (the module isn't re-evaluated on client-side
 * navigation) so flipping a drone on /drones/[droneId] still shows
 * the pending overlay back on /drones. It clears on a full page
 * reload, which doubles as "long enough for the next race cycle to
 * have run".
 *
 * Components subscribe via `usePendingToggle(droneId)` which uses
 * `useSyncExternalStore` so React re-renders the moment the entry
 * is added or cleared.
 */

import { useSyncExternalStore } from 'react';

const pending = new Map();
const listeners = new Set();
let version = 0;

/* Race cron fires every 180s. Pending self-clears one full cycle
   after the toggle - by then matchmaking has consumed the new active
   state. No polling, no reconcile loop: the entry's own timer wakes
   up, deletes itself, notifies subscribers, and the badge naturally
   falls back to `drone.active` (the DB write landed at toggle time). */
const PENDING_RACE_CYCLE_MS = 180_000;

function notify() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPendingToggle(droneId, intended) {
  // Cancel any prior auto-clear timer for this drone before installing
  // a new one (e.g. the cancel/undo path or a rapid second toggle).
  const existing = pending.get(droneId);
  if (existing?.timer) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pending.delete(droneId);
    notify();
  }, PENDING_RACE_CYCLE_MS);

  pending.set(droneId, { intended, ts: Date.now(), timer });
  notify();
}

export function clearPendingToggle(droneId) {
  const existing = pending.get(droneId);
  if (!existing) return;
  if (existing.timer) clearTimeout(existing.timer);
  pending.delete(droneId);
  notify();
}

/** Non-reactive read - safe inside `useMemo` selectors that already
 *  list `usePendingToggleVersion()` as a dep. */
export function getPendingToggle(droneId) {
  return pending.get(droneId) ?? null;
}

export function usePendingToggle(droneId) {
  return useSyncExternalStore(
    subscribe,
    () => pending.get(droneId) ?? null,
    () => null,
  );
}

/** Reactive version counter that bumps every time the pending Map
 *  mutates. Use as a `useMemo` dep when deriving from `getPendingToggle`
 *  for many drones at once (e.g. the dashboard spotlight's
 *  `activeDrones` filter). */
export function usePendingToggleVersion() {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}
