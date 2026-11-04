/**
 * A generated card image for tokens that have no art file yet: mods and placeholder skins
 * (SPEC.md 2.6, 8 `/api/metadata/[token]/image`). Plain SVG with no scripts, links, external
 * references or fonts to fetch; every text value is XML-escaped. Colors are the `app/globals.css`
 * values (a test keeps them in sync), since an image cannot read the page's CSS variables.
 */

/** `--rarity-*` in app/globals.css. */
export const RARITY_COLORS = Object.freeze({
  common: '#9E9E9E',
  rare: '#4A9EFF',
  epic: '#BB86FC',
  legendary: '#FFD700',
});

/** `--bg-card`, `--text-primary`, `--text-secondary` in app/globals.css. */
export const CARD_COLORS = Object.freeze({
  background: '#121212',
  text: '#FFFFFF',
  muted: '#A0A0A0',
});

/**
 * Escape a value for XML text or a quoted attribute.
 * @param {string} value
 */
export function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Longest name drawn before it is cut with an ellipsis (the card is 512 px wide). */
const MAX_NAME = 24;

/**
 * The card for one item.
 * @param {{ name: string, rarity: string, kind: 'skin' | 'mod' }} item
 * @returns {string} an SVG document
 */
export function itemCardSvg({ name, rarity, kind }) {
  const color =
    RARITY_COLORS[/** @type {keyof typeof RARITY_COLORS} */ (rarity)] ?? RARITY_COLORS.common;
  const label = `${rarity in RARITY_COLORS ? rarity : 'common'} ${kind}`.toUpperCase();
  const shown = name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
    `<rect width="512" height="512" fill="${CARD_COLORS.background}"/>`,
    `<rect x="16" y="16" width="480" height="480" rx="24" fill="none" stroke="${color}" stroke-width="8"/>`,
    `<circle cx="256" cy="200" r="88" fill="none" stroke="${color}" stroke-width="6"/>`,
    `<text x="256" y="372" fill="${CARD_COLORS.text}" font-family="sans-serif" font-size="36" font-weight="700" text-anchor="middle">${escapeXml(shown)}</text>`,
    `<text x="256" y="420" fill="${color}" font-family="sans-serif" font-size="24" text-anchor="middle">${escapeXml(label)}</text>`,
    `<text x="256" y="464" fill="${CARD_COLORS.muted}" font-family="sans-serif" font-size="18" text-anchor="middle">HYPERDROME</text>`,
    '</svg>',
  ].join('');
}
