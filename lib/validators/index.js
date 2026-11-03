import { z } from 'zod';

/**
 * Drone Manager - Zod validators for every API request body and query.
 * Since the project is plain JavaScript, these schemas are the runtime
 * contract between frontend and backend. Every API route should call
 * `schema.safeParse(input)` and return 400 on failure.
 */

/** POST /api/skins/apply - bind an unbound owned skin to the drone. */
export const bindSkinSchema = z.object({
  drone_id: z.uuid(),
  skin_id: z.uuid(),
});

/** POST /api/skins/equip - equip a bound skin from the drone's collection.
 *  Pass `skin_id: null` to unequip the currently-equipped skin (the drone
 *  reverts to its tier silhouette; bound skins stay in the collection). */
export const equipSkinSchema = z.object({
  drone_id: z.uuid(),
  skin_id: z.uuid().nullable(),
});

/** PATCH /api/admin/config - update a single admin_config row. */
export const updateAdminConfigSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
});

/**
 * Shared query schema for paginated list endpoints. Accepts string inputs
 * from URLSearchParams and coerces to numbers.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: z.string().optional(),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});
