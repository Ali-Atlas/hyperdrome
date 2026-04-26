import clsx from 'clsx';

/**
 * Merge classnames. Thin wrapper around clsx so component code can
 * compose CSS Module class names with conditional/extra classes in one call.
 * @param  {...any} inputs - class values (string, object, array, falsy)
 * @returns {string}
 */
export function cn(...inputs) {
  return clsx(inputs);
}

/**
 * Return the level tier name based on the bracket:
 * 1-5 → steel, 6-10 → orange, 11-15 → purple, 16+ → gold.
 * @param {number} level
 * @returns {'steel'|'orange'|'purple'|'gold'}
 */
export function getLevelTier(level) {
  const lvl = Number(level) || 0;
  if (lvl <= 5) return 'steel';
  if (lvl <= 10) return 'orange';
  if (lvl <= 15) return 'purple';
  return 'gold';
}

/**
 * Return the CSS custom property for a level's tier color.
 * Use like: `color: ${getLevelColor(drone.level)}` or via style.
 * @param {number} level
 * @returns {string} CSS `var(--level-...)` reference
 */
export function getLevelColor(level) {
  return `var(--level-${getLevelTier(level)})`;
}

/**
 * Return the drone tier (1-4) for a level. 1-5 -> 1, 6-10 -> 2,
 * 11-15 -> 3, 16-20 -> 4.
 * @param {number} level
 * @returns {1|2|3|4}
 */
export function getDroneTier(level) {
  const lvl = Number(level) || 1;
  if (lvl <= 5) return 1;
  if (lvl <= 10) return 2;
  if (lvl <= 15) return 3;
  return 4;
}

/**
 * Return the default tier-silhouette drone image path for a given level.
 * Served as WebP - ~95% smaller than the PNG sources while preserving
 * transparency and visual fidelity at our render sizes.
 * @param {number} level
 * @returns {string}
 */
export function getDroneImageByLevel(level) {
  return `/drones/tier-${getDroneTier(level)}.webp`;
}

/**
 * Skins that have a tier-specific applied-on-drone render available
 * under `/skins/{rarity}/{slug}_tier{N}.webp`. Keys are filename slugs
 * (matching the imageUrl path), values list the tiers (1-4) for which
 * a render exists. Add an entry when a new applied render is dropped
 * into public/skins/.
 */
const APPLIED_RENDERS = {
  ember: [1],
  chrome_fury: [4],
  crystal_phantom: [4],
  dragon_scale: [4],
  obsidian_core: [4],
};

/**
 * If the equipped skin has a tier-specific applied render for the
 * drone's current tier, return its path. Else null.
 * @param {object} skin - drone.appliedSkin payload (with imageUrl)
 * @param {number} level - drone level
 * @returns {string|null}
 */
function getAppliedTierRender(skin, level) {
  const url = skin?.imageUrl;
  if (!url || !url.startsWith('/skins/')) return null;
  const parts = url.split('/');
  if (parts.length < 4) return null;
  const rarity = parts[2];
  const slug = parts[3].replace(/\.webp$/, '');
  const tiers = APPLIED_RENDERS[slug];
  if (!tiers) return null;
  const tier = getDroneTier(level);
  if (!tiers.includes(tier)) return null;
  return `/skins/${rarity}/${slug}_tier${tier}.webp`;
}

/**
 * Resolve the image a drone card should render. Priority chain:
 *  1. Equipped skin's tier-specific applied render (if one exists for
 *     the drone's current tier)
 *  2. Equipped skin's swatch imageUrl
 *  3. drone.imageUrl when it's a custom value (not the legacy
 *     `/drones/default.png` placeholder)
 *  4. Tier silhouette by drone level
 * @param {object} drone - a drone payload (may include `appliedSkin`)
 * @returns {string}
 */
export function getDroneImage(drone) {
  const skin = drone?.appliedSkin;
  if (skin?.imageUrl) {
    const tierRender = getAppliedTierRender(skin, drone?.level ?? 1);
    if (tierRender) return tierRender;
    return skin.imageUrl;
  }
  const custom = drone?.imageUrl;
  if (custom && custom !== '/drones/default.png') return custom;
  return getDroneImageByLevel(drone?.level ?? 1);
}

/**
 * Each seeded track has a signature neon accent color. Not stored in the
 * DB (the schema doesn't have a `color` column), so we map by name here
 * and fall back to teal for any unknown track.
 */
const TRACK_NEON = {
  'Neon Straightaway': '#00F0FF',
  'The Grid':          '#00FF7A',
  'Circuit Alpha':     '#FF8C42',
  'Skyline Drift':     '#BB86FC',
  'Voltage Loop':      '#FFD700',
  'Tempest Run':       '#FF4D5E',
  'Horizon Express':   '#E8E8E8',
};

/**
 * Signature neon color for a track, keyed by track name.
 * @param {string} name
 * @returns {string} hex color
 */
export function getTrackNeon(name) {
  return TRACK_NEON[name] ?? 'var(--accent-primary)';
}

/**
 * Difficulty (1-10) maps to a tier color: 1-3 teal, 4-6 purple, 7-10 red.
 * Returned as a CSS value ready to drop into `color` or `background`.
 * @param {number} difficulty
 * @returns {string}
 */
export function getDifficultyColor(difficulty) {
  const d = Number(difficulty) || 0;
  if (d <= 3) return 'var(--accent-primary)';
  if (d <= 6) return 'var(--accent-secondary)';
  return 'var(--accent-error)';
}
