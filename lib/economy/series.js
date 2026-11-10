/**
 * Chart series for the economy page (SPEC.md 11), derived on the client from the snapshots of
 * `GET /api/economy`. Pure.
 */

/**
 * @typedef {object} Snapshot
 * @property {number} slot
 * @property {string} at ISO time of the tick
 * @property {number | null} supply
 * @property {number} minted today's (UTC) Volts minted at the tick
 * @property {number} burned today's Volts burned at the tick
 * @property {number} openListings
 * @property {number} trades
 * @property {{ slug: string, volts: number, drones: number, openListings: number }[]} teams
 */

/** @param {string} iso */
const dayOf = (iso) => iso.slice(0, 10);

/**
 * Volts minted and burned across the window, added up from one tick to the next. The snapshot
 * figures are today's totals, so they start again at 0 each UTC day: across a day boundary the
 * new day's figure is the step.
 * @param {Snapshot[]} snapshots oldest first
 * @returns {{ minted: number[], burned: number[] }}
 */
export function flowSeries(snapshots) {
  const minted = [];
  const burned = [];
  let m = 0;
  let b = 0;
  snapshots.forEach((s, i) => {
    if (i > 0) {
      const prev = snapshots[i - 1];
      const sameDay = dayOf(prev.at) === dayOf(s.at);
      m += sameDay && s.minted >= prev.minted ? s.minted - prev.minted : s.minted;
      b += sameDay && s.burned >= prev.burned ? s.burned - prev.burned : s.burned;
    }
    minted.push(m);
    burned.push(b);
  });
  return { minted, burned };
}

/**
 * One team's Volts at each snapshot; null where the snapshot has no row for it.
 * @param {Snapshot[]} snapshots
 * @param {string} slug
 * @returns {(number | null)[]}
 */
export function teamVoltSeries(snapshots, slug) {
  return snapshots.map((s) => s.teams.find((t) => t.slug === slug)?.volts ?? null);
}

/**
 * The index one hour after (or before) snapshot `i`, for the step-through: the first snapshot at
 * least an hour later, else the last (the first going back).
 * @param {Snapshot[]} snapshots
 * @param {number} i
 * @param {1 | -1} direction
 * @returns {number}
 */
export function stepHour(snapshots, i, direction) {
  if (snapshots.length === 0) return 0;
  const target = Date.parse(snapshots[i].at) + direction * 3_600_000;
  if (direction > 0) {
    const next = snapshots.findIndex((s, j) => j > i && Date.parse(s.at) >= target);
    return next === -1 ? snapshots.length - 1 : next;
  }
  for (let j = i - 1; j >= 0; j -= 1) {
    if (Date.parse(snapshots[j].at) <= target) return j;
  }
  return 0;
}
