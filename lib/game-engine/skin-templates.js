/**
 * The 32 catalog skins (SPEC.md 2.6), a mirror of the contract's `constants/catalog.rs` `SKINS`
 * and `SKIN_TIER_RENDERS`, checked by a test. Template ids are 1-based in SPEC order; 0 is a
 * placeholder skin. Art lives at `public/skins/<rarity>/<file>.webp`.
 */

/** Rarity names by rarity id (SPEC.md 4.2: common 0, rare 1, epic 2, legendary 3). */
export const RARITY_NAMES = /** @type {const} */ (['common', 'rare', 'epic', 'legendary']);

/** @typedef {(typeof RARITY_NAMES)[number]} Rarity */

/**
 * @typedef {object} SkinTemplate
 * @property {number} id
 * @property {string} slug
 * @property {string} name display name
 * @property {Rarity} rarity
 * @property {string} file image file stem under `public/skins/<rarity>/`
 */

/** Slugs in template id order, 8 per rarity. */
const SLUGS = [
  ['bone', 'cobalt', 'dusk', 'ember', 'frost', 'rust', 'shadow', 'venom'],
  [
    'anodized_blaze',
    'arctic_fury',
    'chrome_fury',
    'copper_king',
    'gunmetal_storm',
    'jade_circuit',
    'midnight_oil',
    'titanium_ghost',
  ],
  [
    'crystal_phantom',
    'dragon_scale',
    'frozen_abyss',
    'iridescent_wraith',
    'liquid_mercury',
    'obsidian_core',
    'solar_flare',
    'void_bloom',
  ],
  [
    'apex_predator',
    'celestial',
    'diamond_hands',
    'gilded_throne',
    'kraken',
    'necromancer',
    'samurai',
    'valiant',
  ],
];

/** Files whose stem differs from the slug. */
const FILE_OVERRIDES = /** @type {Record<string, string>} */ ({ diamond_hands: 'diamond_hand' });

/** @param {string} slug */
const titleCase = (slug) =>
  slug
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** @type {readonly SkinTemplate[]} */
export const SKIN_TEMPLATES = Object.freeze(
  SLUGS.flatMap((slugs, rarityId) =>
    slugs.map((slug, i) =>
      Object.freeze({
        id: rarityId * 8 + i + 1,
        slug,
        name: titleCase(slug),
        rarity: RARITY_NAMES[rarityId],
        file: FILE_OVERRIDES[slug] ?? slug,
      })
    )
  )
);

/**
 * Non-legendary skins with an on-drone render, as [template id, drone tier] (SPEC.md 2.6).
 * Legendary skins equip on any tier; their art is the whole drone.
 */
export const SKIN_TIER_RENDERS = Object.freeze([
  [4, 1],
  [11, 4],
  [17, 4],
  [18, 4],
  [19, 4],
  [22, 4],
]);

/**
 * A catalog skin by template id, or null (0 and unknown ids).
 * @param {number} id
 * @returns {SkinTemplate | null}
 */
export function skinTemplate(id) {
  return SKIN_TEMPLATES[id - 1] ?? null;
}

/**
 * The public path of a catalog skin's art.
 * @param {SkinTemplate} t
 */
export function skinImagePath(t) {
  return `/skins/${t.rarity}/${t.file}.webp`;
}

/**
 * Drone art tier for a level (SPEC.md 2.1): L1-5 tier 1, 6-10 tier 2, 11-15 tier 3, 16+ tier 4.
 * @param {number} level
 */
export function droneTier(level) {
  return Math.min(4, Math.max(1, Math.ceil(level / 5)));
}

/**
 * The image of a drone at `level` wearing `skin` (a catalog template or null): the legendary art,
 * else the skin's tier render where one exists, else the tier base.
 * @param {number} level
 * @param {SkinTemplate | null} skin
 */
export function droneImagePath(level, skin) {
  const tier = droneTier(level);
  if (skin?.rarity === 'legendary') return skinImagePath(skin);
  if (skin && SKIN_TIER_RENDERS.some(([id, t]) => id === skin.id && t === tier)) {
    return `/skins/${skin.rarity}/${skin.file}_tier${tier}.webp`;
  }
  return `/drones/tier-${tier}.webp`;
}
