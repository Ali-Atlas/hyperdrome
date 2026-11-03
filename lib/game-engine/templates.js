/**
 * Mod templates (SPEC.md 2.5): the JS mirror of the contract's `constants/catalog.rs`. Ids are
 * 1-based in SPEC order; 0 means "no mod". A test asserts this table matches the contract.
 */

/** camelCase stat keys in SPEC.md 2.1 order (the order of the contract's `[u8; 9]`). */
export const STAT_KEYS = /** @type {const} */ ([
  'speed',
  'turning',
  'acceleration',
  'durability',
  'nightVision',
  'batteryCapacity',
  'rainHandling',
  'windResistance',
  'consistency',
]);

/** @typedef {typeof STAT_KEYS[number]} StatKey */
/** @typedef {Record<StatKey, number>} Stats */
/** @typedef {'phantom_drive' | 'quantum_sync' | 'storm_rider'} Special */

/**
 * @typedef {object} ModTemplate
 * @property {number} id 1-based template id
 * @property {string} name
 * @property {'common' | 'rare' | 'epic' | 'legendary'} rarity
 * @property {StatKey | null} bonusStat null for legendary mods, which carry a special instead
 * @property {number} bonusPct
 * @property {StatKey} penaltyStat
 * @property {number} penaltyPct
 * @property {Special | null} special
 */

export const SPECIAL_PHANTOM_DRIVE = 'phantom_drive';
export const SPECIAL_QUANTUM_SYNC = 'quantum_sync';
export const SPECIAL_STORM_RIDER = 'storm_rider';

/**
 * @param {number} id
 * @param {string} name
 * @param {ModTemplate['rarity']} rarity
 * @param {[StatKey, number]} bonus
 * @param {[StatKey, number]} penalty
 * @returns {ModTemplate}
 */
const statMod = (id, name, rarity, [bonusStat, bonusPct], [penaltyStat, penaltyPct]) => ({
  id,
  name,
  rarity,
  bonusStat,
  bonusPct,
  penaltyStat,
  penaltyPct,
  special: null,
});

/**
 * @param {number} id
 * @param {string} name
 * @param {Special} special
 * @param {[StatKey, number]} penalty
 * @returns {ModTemplate}
 */
const specialMod = (id, name, special, [penaltyStat, penaltyPct]) => ({
  id,
  name,
  rarity: 'legendary',
  bonusStat: null,
  bonusPct: 0,
  penaltyStat,
  penaltyPct,
  special,
});

/** @type {readonly ModTemplate[]} */
export const MOD_TEMPLATES = Object.freeze([
  statMod(1, 'Streamline Plate', 'common', ['speed', 2], ['turning', 1]),
  statMod(2, 'Grip Pads', 'common', ['turning', 2], ['speed', 1]),
  statMod(3, 'Quick Charge', 'common', ['batteryCapacity', 2], ['durability', 1]),
  statMod(4, 'Shock Absorber', 'common', ['durability', 2], ['acceleration', 1]),
  statMod(5, 'Steady Module', 'common', ['consistency', 2], ['speed', 1]),
  statMod(6, 'Night Lens', 'common', ['nightVision', 2], ['rainHandling', 1]),
  statMod(7, 'Rain Shield', 'common', ['rainHandling', 2], ['windResistance', 1]),
  statMod(8, 'Wind Fin', 'common', ['windResistance', 2], ['nightVision', 1]),
  statMod(9, 'Light Frame', 'common', ['acceleration', 2], ['durability', 1]),
  statMod(10, 'Tracker Coil', 'common', ['turning', 2], ['batteryCapacity', 1]),
  statMod(11, 'Aero Shell', 'rare', ['speed', 4], ['turning', 2]),
  statMod(12, 'Grip Coating', 'rare', ['turning', 4], ['acceleration', 2]),
  statMod(13, 'Storm Plating', 'rare', ['rainHandling', 4], ['speed', 2]),
  statMod(14, 'Night Optics', 'rare', ['nightVision', 4], ['batteryCapacity', 2]),
  statMod(15, 'Turbo Intake', 'rare', ['acceleration', 4], ['consistency', 2]),
  statMod(16, 'Endurance Core', 'rare', ['batteryCapacity', 4], ['speed', 2]),
  statMod(17, 'Aileron Kit', 'rare', ['windResistance', 4], ['acceleration', 2]),
  statMod(18, 'Stabilizer Brace', 'rare', ['consistency', 4], ['speed', 2]),
  statMod(19, 'Plasma Core', 'epic', ['acceleration', 6], ['consistency', 4]),
  statMod(20, 'Stealth Aero', 'epic', ['speed', 6], ['durability', 4]),
  statMod(21, 'Typhoon Module', 'epic', ['rainHandling', 8], ['speed', 5]),
  statMod(22, 'Predator Lens', 'epic', ['nightVision', 8], ['batteryCapacity', 5]),
  statMod(23, 'Iron Hull', 'epic', ['durability', 7], ['turning', 4]),
  specialMod(24, 'Phantom Drive', SPECIAL_PHANTOM_DRIVE, ['windResistance', 5]),
  specialMod(25, 'Quantum Sync', SPECIAL_QUANTUM_SYNC, ['speed', 4]),
  specialMod(26, 'Storm Rider', SPECIAL_STORM_RIDER, ['acceleration', 6]),
]);

/**
 * The template with this 1-based id, or null for 0 or an unknown id.
 * @param {number} id
 * @returns {ModTemplate | null}
 */
export function modTemplate(id) {
  return Number.isInteger(id) && id >= 1 ? (MOD_TEMPLATES[id - 1] ?? null) : null;
}

/**
 * Stats object -> the 9-entry array in contract order.
 * @param {Stats} stats
 * @returns {number[]}
 */
export function statsToArray(stats) {
  return STAT_KEYS.map((k) => stats[k]);
}

/**
 * The 9-entry array in contract order -> stats object.
 * @param {ArrayLike<number>} values
 * @returns {Stats}
 */
export function statsFromArray(values) {
  if (values.length !== STAT_KEYS.length) throw new Error('expected 9 stats');
  return /** @type {Stats} */ (Object.fromEntries(STAT_KEYS.map((k, i) => [k, values[i]])));
}
