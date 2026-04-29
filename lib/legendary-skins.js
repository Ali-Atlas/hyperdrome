/**
 * Per-legendary-skin color palette. Single source of truth for the
 * card background + rotating-shine border colors used across all
 * drone-card surfaces (dashboard, drones index, drone detail,
 * marketplace, race detail, leaderboard).
 *
 * Shape per entry:
 *   - body:      card background color (the drone's body / shell color)
 *   - primary:   the dominant accent (border base color)
 *   - secondary: the chase accent (rotating shine highlight)
 *   - bgTint:    OPTIONAL. The color used for the faint top-of-card body
 *                wash (`::after`'s linear gradient overlay). Defaults to
 *                `primary` when unset. Used when the border color and the
 *                body tint should differ — e.g. Valiant: white body wash,
 *                ice-blue border.
 *
 * Slug keys match the file stem under public/skins/legendary/{slug}.webp.
 * `lib/utils.js#getLegendaryTheme()` normalizes a skin name or slug,
 * looks it up here, and shapes it into the `{ bg, glow1, glow2 }`
 * payload the CSS expects.
 *
 * Add an entry when a new legendary skin lands. Unknown slugs fall
 * through to a neutral fallback inside getLegendaryTheme.
 */

export const LEGENDARY_SKINS = {
  apex_predator: {
    name: 'Apex Predator',
    body: '#0A0A0A',
    primary: '#FF6D00',
    secondary: '#76FF03',
    description: 'Black panther body, acid green eyes, orange engines.',
  },
  celestial: {
    name: 'Celestial',
    body: '#0A0A0A',
    primary: '#5C6BC0',
    secondary: '#FF69B4',
    description: 'Translucent purple-blue shell, nebula pink + violet trim.',
  },
  gilded_throne: {
    name: 'Gilded Throne',
    body: '#0A0A0A',
    primary: '#FF3030',
    secondary: '#FFD700',
    description: 'Dark burgundy panels, gold filigree, ruby gems.',
  },
  valiant: {
    name: 'Valiant',
    body: '#0A0A0A',
    primary: '#B0E0FF',
    secondary: '#FFFFFF',
    bgTint: '#FFFFFF',
    description: 'Polished steel body, ice blue engines, white visor.',
  },
  samurai: {
    name: 'Samurai',
    body: '#0A0A0A',
    primary: '#D50000',
    secondary: '#FFD700',
    description: 'Black lacquer body, gold trim, blood red blade edges.',
  },
  necromancer: {
    name: 'Necromancer',
    body: '#0A0A0A',
    primary: '#76FF03',
    secondary: '#7C4DFF',
    description: 'Bone grey body, acid green eyes, purple wing vents.',
  },
  diamond_hands: {
    name: 'Diamond Hands',
    body: '#0A0A0A',
    primary: '#2979FF',
    secondary: '#FF4081',
    description: 'Matte black framework, electric blue engines, pink accents.',
  },
  kraken: {
    name: 'Kraken',
    body: '#0A0A0A',
    primary: '#2979FF',
    secondary: '#7C4DFF',
    description: 'Deep abyssal blue-black body, electric blue eyes, violet patterns.',
  },
};
