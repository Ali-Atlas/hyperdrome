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
