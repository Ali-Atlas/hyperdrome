import { z } from 'zod';

/**
 * Drone Manager - Zod validators for every API request body and query.
 * Since the project is plain JavaScript, these schemas are the runtime
 * contract between frontend and backend. Every API route should call
 * `schema.safeParse(input)` and return 400 on failure.
 */

/** A single stat value inside `stat_changes`. Positive integer, bounded to 100. */
const statValueSchema = z.number().int().positive().max(100);

/**
 * POST /api/drones/[droneId]/allocate - apply a new stat allocation.
 * `stat_changes` is a partial map: absent keys mean "leave as-is".
 */
export const allocateStatsSchema = z.object({
  drone_id: z.uuid(),
  stat_changes: z.object({
    speed: statValueSchema.optional(),
    turning: statValueSchema.optional(),
    acceleration: statValueSchema.optional(),
    durability: statValueSchema.optional(),
    night_vision: statValueSchema.optional(),
    battery_capacity: statValueSchema.optional(),
    rain_handling: statValueSchema.optional(),
    wind_resistance: statValueSchema.optional(),
    consistency: statValueSchema.optional(),
  }),
});

/** POST /api/drones/[droneId]/toggle - activate or deactivate a drone. */
export const toggleDroneSchema = z.object({
  drone_id: z.uuid(),
  active: z.boolean(),
});

/**
 * POST /api/marketplace - list a drone, skin, or mod for sale.
 * The matching id field is required for the chosen item_type.
 */
export const createListingSchema = z
  .object({
    item_type: z.enum(['drone', 'skin', 'mod']),
    drone_id: z.uuid().optional(),
    skin_id: z.uuid().optional(),
    mod_id: z.uuid().optional(),
    price: z.number().int().min(10),
  })
  .refine(
    (data) => {
      if (data.item_type === 'drone') return !!data.drone_id;
      if (data.item_type === 'skin') return !!data.skin_id;
      return !!data.mod_id;
    },
    {
      message:
        'drone_id is required for drone listings, skin_id for skin listings, mod_id for mod listings',
    },
  );

/** POST /api/drones/[droneId]/mods/equip - equip a bound mod on the drone. */
export const equipModSchema = z.object({
  drone_id: z.uuid(),
  mod_id: z.uuid(),
});

/** POST /api/drones/[droneId]/mods/bind - bind an unbound owned mod to the drone. */
export const bindModSchema = z.object({
  drone_id: z.uuid(),
  mod_id: z.uuid(),
});

/** POST /api/skins/apply - bind an unbound owned skin to the drone. */
export const bindSkinSchema = z.object({
  drone_id: z.uuid(),
  skin_id: z.uuid(),
});

/** POST /api/skins/equip - equip a bound skin from the drone's collection. */
export const equipSkinSchema = z.object({
  drone_id: z.uuid(),
  skin_id: z.uuid(),
});

/** POST /api/marketplace/[listingId]/buy - buy an active listing. */
export const buyListingSchema = z.object({
  listing_id: z.uuid(),
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
