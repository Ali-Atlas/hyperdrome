/**
 * Zod schemas for the gameplay mutation bodies (SPEC.md 8). Every chain action carries a
 * client-generated `actionId` (uuid), its idempotency key. Bodies are strict: unknown keys fail.
 */
import { z } from 'zod';

/** Client-generated idempotency key for one action. */
export const actionIdSchema = z.uuid();

/** On-chain token ids (SPEC.md 4.2): `d:<n>`, `s:<n>`, `m:<n>`, n from 1. */
export const tokenIdSchema = z.string().regex(/^[dsm]:[1-9][0-9]{0,17}$/, 'not a token id');
export const itemTokenSchema = z.string().regex(/^[sm]:[1-9][0-9]{0,17}$/, 'not a skin or mod');

/** Pack and capsule tiers (SPEC.md 2.7) and their contract tier ids (4.4 `open_pack`). */
export const PACK_TIERS = /** @type {const} */ (['starter', 'premium', 'legendary']);

/** Highest listing price accepted; keeps the integer exact in JSON and in the cache column. */
export const MAX_LIST_PRICE = 2_000_000_000;

/** POST /api/drones/[id]/allocate: the full new stat line, 9 values in SPEC.md 2.1 order. */
export const allocateBodySchema = z.strictObject({
  actionId: actionIdSchema,
  stats: z.array(z.number().int().min(1).max(100)).length(9),
});

/** POST /api/drones/[id]/equip: a bound item of `kind`, or null to clear the slot. */
export const equipBodySchema = z
  .strictObject({
    actionId: actionIdSchema,
    kind: z.enum(['skin', 'mod']),
    item: itemTokenSchema.nullable(),
  })
  .refine((b) => b.item === null || b.item[0] === b.kind[0], {
    message: 'item does not match kind',
    path: ['item'],
  });

/** POST /api/drones/[id]/bind: an unbound skin or mod the player owns. */
export const bindBodySchema = z.strictObject({
  actionId: actionIdSchema,
  item: itemTokenSchema,
});

/** POST /api/drones/vendor. */
export const vendorBodySchema = z.strictObject({ actionId: actionIdSchema });

/** POST /api/drones/[id]/toggle (database only, SPEC.md 2.2 slots). */
export const toggleBodySchema = z.strictObject({ active: z.boolean() });

/** POST /api/marketplace/list: price in whole Volts, at least 10 (SPEC.md 2.8). */
export const listBodySchema = z.strictObject({
  actionId: actionIdSchema,
  token: tokenIdSchema,
  price: z.number().int().min(10).max(MAX_LIST_PRICE),
});

/** POST /api/marketplace/buy and /cancel. */
export const tokenActionBodySchema = z.strictObject({
  actionId: actionIdSchema,
  token: tokenIdSchema,
});

/** POST /api/packs/open: a skin pack or a mod capsule of a tier. */
export const packOpenBodySchema = z.strictObject({
  actionId: actionIdSchema,
  kind: z.enum(['skin', 'mod']),
  tier: z.enum(PACK_TIERS),
});

/** Route params: the app's drone id (uuid). */
export const droneIdParamSchema = z.uuid();
