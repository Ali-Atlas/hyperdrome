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

function notify() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPendingToggle(droneId, intended) {
  pending.set(droneId, { intended });
  notify();
}

export function clearPendingToggle(droneId) {
  if (!pending.has(droneId)) return;
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
