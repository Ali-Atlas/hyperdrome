/**
 * A settled race as the results view shows it (SPEC.md 11): the drones as they raced, from the
 * settle snapshots (SPEC.md 7), and the client-safe log (SPEC.md 5) with what the segment view
 * reads. Pure.
 */
import { modTemplate, statsFromArray } from '@/lib/game-engine/templates.js';

/**
 * @typedef {{ stats: number[], modTemplate: number, skinTemplate: number, level: number, elo: number }} Snapshot
 * @typedef {{ lap: number, type: string, gapMs: number }} LogEntry the engine's log: `gapMs` is
 *   the cumulative time of drone 1 minus drone 2 after the segment
 * @typedef {LogEntry & { segment: number, gap: number, step: number, drone1Gain: number, drone2Gain: number }} SegmentRow
 *   `segment` counts from 1; `gap` is `gapMs` in seconds; `step` is its change in this segment
 *   (drone 1's segment time minus drone 2's); each `Gain` is what that drone gained on the other
 *   in the segment, in seconds (positive = faster). The log has no per-drone segment times.
 */

/**
 * A drone as it raced: the snapshot's stats, level and mod over the cached drone, which carries
 * today's values. The skin stays the cached one (a snapshot has its template id only).
 * @template {Record<string, any> | null | undefined} T
 * @param {T} drone the cached drone row
 * @param {Snapshot | null | undefined} snapshot
 * @returns {T}
 */
export function racedDrone(drone, snapshot) {
  if (!drone || !snapshot) return drone;
  const mod = modTemplate(snapshot.modTemplate);
  return {
    ...drone,
    ...statsFromArray(snapshot.stats),
    level: snapshot.level,
    appliedMod: mod ? { name: mod.name, rarity: mod.rarity } : null,
  };
}

/**
 * The log rows of the segment view.
 * @param {LogEntry[] | null | undefined} log
 * @returns {SegmentRow[]}
 */
export function segmentRows(log) {
  let prev = 0;
  return (log ?? []).map((seg, i) => {
    const step = (seg.gapMs - prev) / 1000;
    prev = seg.gapMs;
    return {
      ...seg,
      segment: i + 1,
      gap: seg.gapMs / 1000,
      step,
      // `0 - step`, not `-step`: a level segment reads 0, never -0.
      drone1Gain: 0 - step,
      drone2Gain: step,
    };
  });
}

/**
 * A race from `GET /api/races/[id]` for the page: unchanged until it is settled, then with the
 * drones as they raced and the log as segment rows.
 * @template {Record<string, any> | null | undefined} T
 * @param {T} race
 * @returns {T}
 */
export function asRaced(race) {
  if (race?.status !== 'completed') return race;
  return {
    ...race,
    log: segmentRows(race.log),
    drone1: racedDrone(race.drone1, race.snapshotA),
    drone2: racedDrone(race.drone2, race.snapshotB),
  };
}
