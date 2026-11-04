/**
 * Token art (SPEC.md 2.6, 8): the skin catalog mirrors the contract's, drone images follow the
 * tier and equip rules, and the generated card is inert SVG in the app's rarity colors.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SKIN_TEMPLATES,
  SKIN_TIER_RENDERS,
  droneImagePath,
  skinImagePath,
  skinTemplate,
} from '../../lib/game-engine/skin-templates.js';
import {
  CARD_COLORS,
  RARITY_COLORS,
  escapeXml,
  itemCardSvg,
} from '../../lib/metadata/item-card-svg.js';

const read = (/** @type {string} */ path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('skin catalog mirror', () => {
  const catalog = read('contracts/hyperdrome/src/constants/catalog.rs');
  const rarityIds = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3 };
  const rarityNames = ['common', 'rare', 'epic', 'legendary'];

  it('matches SKINS in catalog.rs (id, slug, rarity, file)', () => {
    const plain = [...catalog.matchAll(/skin\((\d+), "([a-z_]+)", (\w+)\)/g)].map((m) => ({
      id: Number(m[1]),
      slug: m[2],
      rarity: rarityNames[rarityIds[/** @type {keyof typeof rarityIds} */ (m[3])]],
      file: m[2],
    }));
    const special = [
      ...catalog.matchAll(/id: (\d+),\s*slug: "([a-z_]+)",\s*rarity: (\w+),\s*file: "([a-z_]+)"/g),
    ].map((m) => ({
      id: Number(m[1]),
      slug: m[2],
      rarity: rarityNames[rarityIds[/** @type {keyof typeof rarityIds} */ (m[3])]],
      file: m[4],
    }));
    const rust = [...plain, ...special].sort((a, b) => a.id - b.id);
    expect(rust).toHaveLength(32);
    expect(
      SKIN_TEMPLATES.map(({ id, slug, rarity, file }) => ({ id, slug, rarity, file }))
    ).toEqual(rust);
  });

  it('matches SKIN_TIER_RENDERS in catalog.rs', () => {
    const line = /SKIN_TIER_RENDERS: \[\(u16, u8\); \d+\] = \[(.*)\];/.exec(catalog)?.[1] ?? '';
    const pairs = [...line.matchAll(/\((\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(SKIN_TIER_RENDERS).toEqual(pairs);
  });

  it('every catalog skin and tier render has a file in public/', () => {
    for (const t of SKIN_TEMPLATES) {
      expect(() => read(`public${skinImagePath(t)}`)).not.toThrow();
    }
    for (const [id, tier] of SKIN_TIER_RENDERS) {
      const t = /** @type {import('../../lib/game-engine/skin-templates.js').SkinTemplate} */ (
        skinTemplate(id)
      );
      expect(() => read(`public/skins/${t.rarity}/${t.file}_tier${tier}.webp`)).not.toThrow();
    }
  });
});

describe('drone images', () => {
  const ember = skinTemplate(4);
  const kraken = skinTemplate(29);
  const chrome = skinTemplate(11);

  it('uses the tier base, the tier render where one exists, and the legendary art', () => {
    expect(droneImagePath(1, null)).toBe('/drones/tier-1.webp');
    expect(droneImagePath(7, null)).toBe('/drones/tier-2.webp');
    expect(droneImagePath(20, null)).toBe('/drones/tier-4.webp');
    expect(droneImagePath(3, ember)).toBe('/skins/common/ember_tier1.webp');
    expect(droneImagePath(6, ember)).toBe('/drones/tier-2.webp');
    expect(droneImagePath(16, chrome)).toBe('/skins/rare/chrome_fury_tier4.webp');
    expect(droneImagePath(2, kraken)).toBe('/skins/legendary/kraken.webp');
    expect(skinImagePath(/** @type {any} */ (skinTemplate(27)))).toBe(
      '/skins/legendary/diamond_hand.webp'
    );
  });
});

describe('generated item card', () => {
  it('uses the rarity and card colors from app/globals.css', () => {
    const css = read('app/globals.css');
    const cssVar = (/** @type {string} */ name) =>
      new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1]?.toUpperCase();
    for (const [rarity, color] of Object.entries(RARITY_COLORS)) {
      expect(cssVar(`rarity-${rarity}`)).toBe(color);
    }
    expect(cssVar('bg-card')).toBe(CARD_COLORS.background);
    expect(cssVar('text-primary')).toBe(CARD_COLORS.text);
    expect(cssVar('text-secondary')).toBe(CARD_COLORS.muted);
  });

  it('escapes every text value and stays inert', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;'
    );
    const svg = itemCardSvg({ name: '<script>alert(1)</script>', rarity: 'epic', kind: 'skin' });
    expect(svg).not.toMatch(/<script|onload|href|xlink|<image|<foreignObject|url\(/i);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain(RARITY_COLORS.epic);
    expect(svg).toContain('EPIC SKIN');
    expect(itemCardSvg({ name: 'Grip Pads', rarity: 'bogus', kind: 'mod' })).toContain(
      'COMMON MOD'
    );
  });
});
