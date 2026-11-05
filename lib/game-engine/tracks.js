/**
 * Track table (SPEC.md 2.9): the JS mirror of the contract's `constants/tables.rs` `TRACKS`. Ids
 * are the contract's 0-based track ids, which `commit_batch` takes in each matchup. A test asserts
 * this table matches the contract source. Level 20+ uses the 16-20 set.
 */

/**
 * @typedef {object} TrackTemplate
 * @property {number} id 0-based contract track id
 * @property {string} name the `tracks.name` of the database row
 * @property {number} minLevel
 * @property {number} maxLevel
 * @property {number} difficulty 1-10
 * @property {number} straights
 * @property {number} turns
 * @property {'short' | 'medium' | 'long'} length
 */

/**
 * @param {number} id
 * @param {string} name
 * @param {[number, number]} levels
 * @param {number} difficulty
 * @param {[number, number]} segments straights, turns
 * @param {TrackTemplate['length']} length
 * @returns {TrackTemplate}
 */
const track = (id, name, [minLevel, maxLevel], difficulty, [straights, turns], length) => ({
  id,
  name,
  minLevel,
  maxLevel,
  difficulty,
  straights,
  turns,
  length,
});

/** @type {readonly TrackTemplate[]} */
export const TRACKS = Object.freeze([
  track(0, 'Horizon Express', [1, 5], 1, [2, 2], 'short'),
  track(1, 'Neon Straightaway', [1, 5], 2, [3, 3], 'medium'),
  track(2, 'Keyhole', [1, 5], 2, [2, 2], 'short'),
  track(3, 'The Grid', [1, 5], 3, [4, 4], 'medium'),
  track(4, 'Meridian', [6, 10], 3, [4, 4], 'medium'),
  track(5, 'Circuit Alpha', [6, 10], 4, [4, 5], 'medium'),
  track(6, 'Crossfire', [6, 10], 4, [3, 5], 'medium'),
  track(7, 'Iron Ribbon', [6, 10], 5, [4, 6], 'long'),
  track(8, 'Skyline Drift', [11, 15], 6, [3, 7], 'long'),
  track(9, 'Helix', [11, 15], 6, [2, 6], 'medium'),
  track(10, 'Switchblade', [11, 15], 7, [3, 8], 'long'),
  track(11, 'Phantom Circuit', [11, 15], 7, [4, 7], 'long'),
  track(12, 'Voltage Loop', [16, 20], 8, [4, 8], 'long'),
  track(13, 'Obsidian Maze', [16, 20], 9, [3, 9], 'long'),
  track(14, 'Apex Descent', [16, 20], 9, [2, 10], 'long'),
  track(15, 'Tempest Run', [16, 20], 10, [2, 8], 'long'),
]);

/**
 * The tracks a drone of `level` may race on (SPEC.md 2.9; 20+ uses the 16-20 set).
 * @param {number} level
 * @returns {TrackTemplate[]}
 */
export function tracksForLevel(level) {
  const l = Math.min(20, level);
  return TRACKS.filter((t) => t.minLevel <= l && l <= t.maxLevel);
}
