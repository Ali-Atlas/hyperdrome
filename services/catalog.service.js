/**
 * The catalog cache (SPEC.md 2.5, 2.6, 7): the contract's `get_catalog()` skin and mod templates in
 * `catalog_templates`, written by the world seed and read by the marketplace page's pack previews.
 * Supply caps are cached (null for Ember and for mods); minted counts stay on chain.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { RARITY_NAMES, skinTemplate } from '@/lib/game-engine/skin-templates.js';
import { STAT_KEYS } from '@/lib/game-engine/templates.js';
import { getNear } from '@/lib/near';

const { catalogTemplates } = schema;

/**
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter }} Deps
 * @typedef {{ created: number, updated: number, skipped: number }} Counts
 * @typedef {{ id: number, slug: string, file: string, rarity: number, rarity_name: string, cap: number | null }} ChainSkin
 * @typedef {{ id: number, name: string, rarity: number, bonus_stat: number | null, bonus_pct: number, penalty_stat: number, penalty_pct: number, special: string | null }} ChainMod
 * @typedef {{ kind: 'skin' | 'mod', template: number, name: string, rarity: string, imageUrl: string | null, cap: number | null, data: Record<string, unknown> }} CatalogRow
 */

/**
 * The cache row of a catalog skin. The display name comes from the app's mirror of the catalog
 * (the contract carries the slug only).
 * @param {ChainSkin} s
 * @returns {CatalogRow}
 */
const skinRow = (s) => ({
  kind: 'skin',
  template: s.id,
  name: skinTemplate(s.id)?.name ?? s.slug,
  rarity: s.rarity_name,
  imageUrl: `/skins/${s.rarity_name}/${s.file}.webp`,
  cap: s.cap ?? null,
  data: { slug: s.slug, file: s.file },
});

/**
 * The cache row of a mod template; mods have no supply cap (SPEC.md 2.5).
 * @param {ChainMod} m
 * @returns {CatalogRow}
 */
const modRow = (m) => ({
  kind: 'mod',
  template: m.id,
  name: m.name,
  rarity: RARITY_NAMES[m.rarity] ?? 'common',
  imageUrl: null,
  cap: null,
  data: {
    bonusStat: m.bonus_stat === null ? null : STAT_KEYS[m.bonus_stat],
    bonusPct: m.bonus_pct,
    penaltyStat: STAT_KEYS[m.penalty_stat],
    penaltyPct: m.penalty_pct,
    special: m.special ?? null,
  },
});

/** The fields a cache row is compared by. @param {CatalogRow} r */
const fingerprint = (r) =>
  JSON.stringify([r.name, r.rarity, r.imageUrl ?? null, r.cap ?? null, sortKeys(r.data)]);

/** @param {Record<string, unknown> | null} data */
const sortKeys = (data) =>
  Object.entries(data ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Bring `catalog_templates` in line with `get_catalog()`: missing templates are inserted, changed
 * ones updated, the rest left alone.
 * @param {Deps} [deps]
 * @returns {Promise<{ skins: Counts, mods: Counts }>}
 */
export async function syncCatalog(deps = {}) {
  const db = deps.db ?? defaultDb;
  const near = deps.near ?? getNear();
  const catalog = /** @type {{ skins: ChainSkin[], mods: ChainMod[] } | null} */ (
    await near.view('get_catalog', {})
  );
  if (!catalog) throw new Error('get_catalog returned nothing');
  /** @type {CatalogRow[]} */
  const existing = await db.select().from(catalogTemplates);
  const byKey = new Map(existing.map((r) => [`${r.kind}:${r.template}`, r]));

  /** @param {CatalogRow[]} wanted */
  const sync = async (wanted) => {
    const counts = { created: 0, updated: 0, skipped: 0 };
    for (const row of wanted) {
      const current = byKey.get(`${row.kind}:${row.template}`);
      if (!current) {
        await db.insert(catalogTemplates).values(row).onConflictDoNothing();
        counts.created += 1;
      } else if (fingerprint(current) !== fingerprint(row)) {
        await db
          .update(catalogTemplates)
          .set({ ...row, syncedAt: new Date() })
          .where(
            and(eq(catalogTemplates.kind, row.kind), eq(catalogTemplates.template, row.template))
          );
        counts.updated += 1;
      } else {
        counts.skipped += 1;
      }
    }
    return counts;
  };
  return {
    skins: await sync(catalog.skins.map(skinRow)),
    mods: await sync(catalog.mods.map(modRow)),
  };
}

/**
 * The skins a pack can drop, for the marketplace page's preview cards (`GET /api/skins/catalog`):
 * every catalog skin, by rarity then name. Empty until the world seed has run.
 * @param {Deps} [deps]
 * @returns {Promise<{ id: string, template: number, name: string, rarity: string, imageUrl: string | null, cap: number | null }[]>}
 */
export async function getSkinCatalog(deps = {}) {
  const db = deps.db ?? defaultDb;
  /** @type {CatalogRow[]} */
  const rows = await db
    .select()
    .from(catalogTemplates)
    .where(eq(catalogTemplates.kind, 'skin'))
    .orderBy(asc(catalogTemplates.rarity), asc(catalogTemplates.name));
  return rows.map((r) => ({
    id: `skin-${r.template}`,
    template: r.template,
    name: r.name,
    rarity: r.rarity,
    imageUrl: r.imageUrl,
    cap: r.cap,
  }));
}
