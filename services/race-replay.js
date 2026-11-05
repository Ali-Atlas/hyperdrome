/**
 * Race replay helpers shared by settlement (services/settle.service.js) and verification
 * (services/race-schedule.service.js): the snapshot of a drone's on-chain state a race runs with
 * (SPEC.md 7), the engine input built from a race row, and the contract's `RaceResult` shape
 * (SPEC.md 4.4). Pure apart from the engine call.
 */
import { raceDrone } from '@/lib/game-engine/mods.js';
import { TIME_OF_DAY, WEATHER, simulateRace } from '@/lib/game-engine/race-simulator.js';
import { statsHash } from '@/lib/game-engine/stats-hash.js';
import { statsFromArray } from '@/lib/game-engine/templates.js';

/**
 * @typedef {{ stats: number[], modTemplate: number, skinTemplate: number, level: number, elo: number }} Snapshot
 * @typedef {{ straights: number, turns: number, difficulty: number, length: string }} TrackRow
 * @typedef {import('@/lib/game-engine/race-simulator.js').RaceResult} RaceResult
 * @typedef {{ hot: { level: number, elo: number, equipped_mod: string | null, equipped_skin: string | null }, cold: { stats: number[] } }} DroneView
 */

/** Races per `settle_batch` call (SPEC.md 4.4, 13). */
export const SETTLE_CHUNK = 40;

/**
 * The race id the engine seeds with (SPEC.md 5).
 * @param {number} slot
 * @param {number} index
 */
export const raceIdOf = (slot, index) => `${slot}:${index}`;

/** @param {ArrayLike<number>} bytes */
export const toHex = (bytes) => Buffer.from(bytes).toString('hex');

/** @param {string} hex @returns {number[]} the contract's `[u8; N]` JSON shape */
export const toBytes = (hex) => [...Buffer.from(hex, 'hex')];

/**
 * Weather and time of day as the contract's table indexes (SPEC.md 2.3 order).
 * @param {string} weather
 * @param {string} timeOfDay
 * @returns {{ weather: number, tod: number }}
 */
export function conditionIndexes(weather, timeOfDay) {
  const w = WEATHER.indexOf(weather);
  const t = TIME_OF_DAY.indexOf(timeOfDay);
  if (w < 0 || t < 0) throw new Error(`unknown conditions ${weather} ${timeOfDay}`);
  return { weather: w, tod: t };
}

/**
 * The snapshot of a drone from `get_drone`, with the equipped items' templates (0 = none).
 * @param {DroneView} view
 * @param {(token: string | null) => number} templateOf
 * @returns {Snapshot}
 */
export function snapshotOf(view, templateOf) {
  return {
    stats: [...view.cold.stats],
    modTemplate: templateOf(view.hot.equipped_mod),
    skinTemplate: templateOf(view.hot.equipped_skin),
    level: view.hot.level,
    elo: view.hot.elo,
  };
}

/**
 * The contract's `stats_hash` of a snapshot (SPEC.md 5), hex.
 * @param {Snapshot} snap
 */
export const snapshotHash = (snap) => statsHash(snap.stats, snap.modTemplate, snap.skinTemplate);

/**
 * Run one race from its stored inputs (SPEC.md 5).
 * @param {{ seed: string, slot: number, index: number, snapshotA: Snapshot, snapshotB: Snapshot, track: TrackRow, weather: string, timeOfDay: string }} input
 * @returns {RaceResult}
 */
export function replayRace({ seed, slot, index, snapshotA, snapshotB, track, weather, timeOfDay }) {
  return simulateRace({
    seed,
    raceId: raceIdOf(slot, index),
    droneA: raceDrone(statsFromArray(snapshotA.stats), snapshotA.modTemplate),
    droneB: raceDrone(statsFromArray(snapshotB.stats), snapshotB.modTemplate),
    track: {
      straights: track.straights,
      turns: track.turns,
      difficulty: track.difficulty,
      length: track.length,
    },
    weather,
    timeOfDay,
  });
}

/**
 * The `RaceResult` `settle_batch` takes for one race (SPEC.md 4.4).
 * @param {{ a: string, b: string, result: RaceResult, snapshotA: Snapshot, snapshotB: Snapshot }} race
 */
export function chainResult({ a, b, result, snapshotA, snapshotB }) {
  return {
    a,
    b,
    winner: result.winner === 'a' ? a : b,
    time_a_ms: result.timeAms,
    time_b_ms: result.timeBms,
    stats_hash_a: toBytes(snapshotHash(snapshotA)),
    stats_hash_b: toBytes(snapshotHash(snapshotB)),
  };
}

/**
 * Milliseconds as the `races.drone1_time` decimal string (seconds).
 * @param {number} ms
 */
export const secondsString = (ms) => (ms / 1000).toFixed(3);
