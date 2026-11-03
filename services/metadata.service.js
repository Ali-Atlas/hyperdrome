/**
 * NEP-177 token metadata and token images for wallets and explorers (SPEC.md 4.3, 8), from the
 * database cache. The JSON mirrors the contract's `nft_token` metadata (title, `extra` with the
 * same keys); `media` points at `/api/metadata/<token>/image`, which serves the art file or a
 * generated card for tokens without art.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import {
  droneImagePath,
  droneTier,
  skinImagePath,
  skinTemplate,
} from '@/lib/game-engine/skin-templates.js';
import { itemCardSvg } from '@/lib/metadata/item-card-svg.js';
import { tokenKind } from './chain-cache.service.js';

const { drones, skins, mods, droneSkins, droneMods } = schema;

/**
 * Mod art files by template id, once they exist (`public/mods/...`). Until a template has an
 * entry, its image is the generated card; adding one switches `/image` to the file with no
 * change to the metadata.
 * @type {Readonly<Record<number, string>>}
 */
export const MOD_ART = Object.freeze({});

/**
 * @typedef {object} TokenMetadata NEP-177 `TokenMetadata`
 * @property {string} title
 * @property {string} description
 * @property {string} media
 * @property {null} media_hash
 * @property {number} copies
 * @property {string} extra JSON summary, the same keys as the contract's
 * @typedef {{ redirect: string } | { svg: string }} TokenImage
 */

/**
 * @param {any} db
 * @param {string} token
 */
async function loadToken(db, token) {
  const kind = tokenKind(token);
  if (kind === 'drone') {
    const [drone] = await db.select().from(drones).where(eq(drones.tokenId, token)).limit(1);
    if (!drone) return null;
    const [skin] = drone.appliedSkinId
      ? await db.select().from(skins).where(eq(skins.id, drone.appliedSkinId)).limit(1)
      : [];
    const [mod] = drone.appliedModId
      ? await db.select().from(mods).where(eq(mods.id, drone.appliedModId)).limit(1)
      : [];
    return { kind, drone, skin: skin ?? null, mod: mod ?? null };
  }
  if (kind === 'skin' || kind === 'mod') {
    const table = kind === 'skin' ? skins : mods;
    const [item] = await db.select().from(table).where(eq(table.tokenId, token)).limit(1);
    if (!item) return null;
    const junction = kind === 'skin' ? droneSkins : droneMods;
    const itemColumn = kind === 'skin' ? droneSkins.skinId : droneMods.modId;
    const [bound] = await db
      .select({ tokenId: drones.tokenId })
      .from(junction)
      .innerJoin(drones, eq(junction.droneId, drones.id))
      .where(eq(itemColumn, item.id))
      .limit(1);
    return { kind, item, boundTo: /** @type {string | null} */ (bound?.tokenId ?? null) };
  }
  return null;
}

/**
 * NEP-177 metadata for a cached token, or null.
 * @param {string} token e.g. `d:6`
 * @param {{ origin: string, db?: any }} options `origin` of the app, for the absolute media URL
 * @returns {Promise<TokenMetadata | null>}
 */
export async function tokenMetadata(token, { origin, db = defaultDb }) {
  const found = await loadToken(db, token);
  if (!found) return null;
  const media = `${origin}/api/metadata/${encodeURIComponent(token)}/image`;
  const common = { media, media_hash: null, copies: 1 };
  if (found.kind === 'drone') {
    const { drone, skin, mod } = found;
    return {
      title: drone.name,
      description: `Hyperdrome racing drone, level ${drone.level}.`,
      ...common,
      extra: JSON.stringify({
        kind: 'drone',
        level: drone.level,
        elo: drone.eloRating,
        tier: droneTier(drone.level),
        equipped: { mod: mod?.tokenId ?? null, skin: skin?.tokenId ?? null },
      }),
    };
  }
  const { item, boundTo } = /** @type {{ item: any, boundTo: string | null }} */ (found);
  const noun = found.kind === 'skin' ? 'skin' : 'mod';
  return {
    title: item.name,
    description: `Hyperdrome ${item.rarity} ${noun}.`,
    ...common,
    extra: JSON.stringify({
      kind: found.kind,
      template: item.template ?? 0,
      rarity: item.rarity,
      bound_to: boundTo,
    }),
  };
}

/**
 * The image for a cached token: a redirect to its art file, or a generated card; null if unknown.
 * @param {string} token
 * @param {{ db?: any }} [deps]
 * @returns {Promise<TokenImage | null>}
 */
export async function tokenImage(token, { db = defaultDb } = {}) {
  const found = await loadToken(db, token);
  if (!found) return null;
  if (found.kind === 'drone') {
    const template = found.skin?.template ? skinTemplate(found.skin.template) : null;
    return { redirect: droneImagePath(found.drone.level, template) };
  }
  const { item } = /** @type {{ item: any }} */ (found);
  if (found.kind === 'skin') {
    const t = item.template ? skinTemplate(item.template) : null;
    if (t) return { redirect: skinImagePath(t) };
  } else if (MOD_ART[item.template]) {
    return { redirect: MOD_ART[item.template] };
  }
  return {
    svg: itemCardSvg({
      name: item.name,
      rarity: item.rarity,
      kind: found.kind === 'skin' ? 'skin' : 'mod',
    }),
  };
}
