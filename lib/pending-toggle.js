'use client';

/**
 * Session-wide pending-toggle state for drone active/inactive flips.
 *
 * Pure store: set / clear / get. Pending entries no longer self-clear
 * via timers - their lifecycle is owned by the page-level round-start
 * effect (lib/race-round-clock.js). When a new race round starts:
 *   - the toggle button on the drone manager is locked while the cron
 *     processes (useRacingInProgress)
 *   - the page refetches drone data
 *   - clearAllPendingToggles() (or per-drone clearPendingToggle) wipes
 *     all entries
 *   - the lock releases
 *
 * State lives in a module-scoped Map so it survives Next.js SPA route
 * changes (toggle on /drones/[droneId] still shows the pending overlay
 * back on /drones). Full page reload clears the Map naturally.
 *
 * Components subscribe via `usePendingToggle(droneId)` /
 * `usePendingToggleVersion()` (`useSyncExternalStore`-backed) so React
 * re-renders the moment any entry is added or cleared.
 */

import { useSyncExternalStore } from 'react';

const pending = new Map();
const listeners = new Set();
let version = 0;

function notify() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPendingToggle(droneId, intended) {
  pending.set(droneId, { intended, ts: Date.now() });
  notify();
}

export function clearPendingToggle(droneId) {
  if (!pending.has(droneId)) return;
  pending.delete(droneId);
  notify();
}

/** Wipes every pending entry in one notify. Used by the round-start
 *  effect on the My Drones list page (the user has no toggle on
 *  that page, so a blanket clear is safe and cheap). */
export function clearAllPendingToggles() {
  if (pending.size === 0) return;
  pending.clear();
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
