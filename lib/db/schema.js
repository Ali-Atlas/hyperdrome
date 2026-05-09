import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
  decimal,
  jsonb,
  index,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Drone Manager - Drizzle ORM schema.
 * Mirrors DEVELOPMENT_PLAN.md Part 3. Check constraints from the plan are
 * enforced at the application layer via Zod validators rather than DB-level
 * CHECKs to keep the schema file portable.
 *
 * NextAuth adapter tables (accounts, sessions) are added in TASK 3.1 when
 * @auth/drizzle-adapter is installed. The verification_token table required
 * by the email provider is declared here so the magic-link flow can persist
 * tokens as soon as auth wiring lands.
 */

/**
 * Users - one row per human player. Created on first magic-link sign-in.
 *
 * Columns are a union of:
 * (a) the app's profile fields (username, points, ELO, season stats, etc.),
 * (b) the columns the @auth/drizzle-adapter default schema requires
 *     (name, emailVerified, image). The adapter populates (b); our
 *     overridden `createUser` (in lib/auth) populates (a).
 *
 * `username` must be nullable at DB level because the adapter writes to this
 * table before our override runs; we backfill a generated username in the
 * same transaction. `email` is kept `unique` so the adapter's
 * `getUserByEmail` lookup works.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  username: varchar('username', { length: 50 }).unique(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  // NextAuth adapter fields
  name: text('name'),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  // App profile fields
  points: integer('points').notNull().default(0),
  totalRaces: integer('total_races').notNull().default(0),
  totalWins: integer('total_wins').notNull().default(0),
  eloRating: integer('elo_rating').notNull().default(1000),
  seasonPoints: integer('season_points').notNull().default(0),
  activeDroneSlots: integer('active_drone_slots').notNull().default(1),
  imageUrl: text('image_url'),
  // MegaETH wallet linked to this user. Stored lowercased; the EIP-55
  // checksummed form is computed on read for display. UNIQUE so a single
  // wallet maps to at most one user. Nullable - wallet linking is opt-in.
  walletAddress: varchar('wallet_address', { length: 42 }).unique(),
});

/** NextAuth: linked OAuth / provider accounts for a user. */
export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  }),
);

/** NextAuth: active sessions (unused when strategy is 'jwt' but adapter expects the table). */
export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: uuid('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

/** NextAuth: email-provider verification token store. */
export const verificationTokens = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);

/**
 * Skins - cosmetic only. userId null = unowned pool for drops/seeding.
 * rarity is 'common' | 'rare' | 'epic' | 'legendary' (app-validated).
 */
export const skins = pgTable(
  'skins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 100 }).notNull(),
    rarity: varchar('rarity', { length: 15 }).notNull(),
    imageUrl: text('image_url').notNull(),
    description: text('description'),
    // MegaETH NFT mint fields. Mirror drones.tokenId / mintTxHash /
    // mintedAt - sequential int assigned at mint time, UNIQUE so
    // collisions fail cleanly, all nullable for unminted rows.
    tokenId: integer('token_id').unique(),
    mintTxHash: varchar('mint_tx_hash', { length: 66 }),
    mintedAt: timestamp('minted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('idx_skins_user_id').on(table.userId),
    rarityIdx: index('idx_skins_rarity').on(table.rarity),
  }),
);

/**
 * Mods - equippable drone hardware. Instance model (each row is unique like
 * skins). userId null = unowned vault. Bound to a drone via the droneMods
 * junction; once bound the mod cannot be listed independently. Drone sale
 * transfers all bound mods to the buyer.
 *
 * stat_bonus_type / stat_penalty_type reference camelCase stat keys
 * ('speed', 'turning', 'rainHandling', etc) or mechanic keys
 * ('battery', 'track_condition'). Validated at the application layer.
 * special_ability is for legendary mods with non-numeric effects.
 */
export const mods = pgTable(
  'mods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 100 }).notNull(),
    rarity: varchar('rarity', { length: 15 }).notNull(),
    description: varchar('description', { length: 500 }),
    statBonusType: varchar('stat_bonus_type', { length: 50 }),
    statBonusValue: decimal('stat_bonus_value', { precision: 5, scale: 2 }),
    statPenaltyType: varchar('stat_penalty_type', { length: 50 }),
    statPenaltyValue: decimal('stat_penalty_value', { precision: 5, scale: 2 }),
    specialAbility: varchar('special_ability', { length: 500 }),
    imageUrl: varchar('image_url', { length: 500 }),
  },
  (table) => ({
    userIdIdx: index('idx_mods_user_id').on(table.userId),
    rarityIdx: index('idx_mods_rarity').on(table.rarity),
  }),
);

/** Drones - individual racers. Owned by users or marked as bots. */
export const drones = pgTable(
  'drones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 100 }).notNull(),
    level: integer('level').notNull().default(1),
    xp: integer('xp').notNull().default(0),
    xpToNextLevel: integer('xp_to_next_level').notNull().default(300),
    totalStatBudget: integer('total_stat_budget').notNull().default(29),
    /**
     * DEPRECATED April 2026. The game now runs on a single player wallet
     * (`users.points`); drones no longer hold spendable points. Column kept
     * to preserve historical rows - no code should read or write it.
     */
    unspentPoints: integer('unspent_points').notNull().default(20),
    /**
     * Running total of player points ever spent upgrading this drone.
     * Incremented on each stat allocation. Used for display + marketplace
     * value assessment; NOT a spendable balance.
     */
    totalPointsInvested: integer('total_points_invested').notNull().default(0),
    speed: integer('speed').notNull().default(1),
    turning: integer('turning').notNull().default(1),
    acceleration: integer('acceleration').notNull().default(1),
    durability: integer('durability').notNull().default(1),
    nightVision: integer('night_vision').notNull().default(1),
    batteryCapacity: integer('battery_capacity').notNull().default(1),
    rainHandling: integer('rain_handling').notNull().default(1),
    windResistance: integer('wind_resistance').notNull().default(1),
    consistency: integer('consistency').notNull().default(1),
    active: boolean('active').notNull().default(false),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    totalRaces: integer('total_races').notNull().default(0),
    eloRating: integer('elo_rating').notNull().default(1000),
    imageUrl: text('image_url').notNull().default('/drones/default.png'),
    isBot: boolean('is_bot').notNull().default(false),
    appliedSkinId: uuid('applied_skin_id').references(() => skins.id, {
      onDelete: 'set null',
    }),
    appliedModId: uuid('applied_mod_id').references(() => mods.id, {
      onDelete: 'set null',
    }),
    // MegaETH NFT mint fields. Sequential integer assigned at mint time
    // (max(token_id) + 1); UNIQUE so a race between two simultaneous
    // mints fails the second cleanly. mint_tx_hash is the on-chain tx
    // (0x + 64 hex = 66 chars). minted_at is the wall-clock time the
    // receipt landed. All three are nullable because most drones won't
    // be minted.
    tokenId: integer('token_id').unique(),
    mintTxHash: varchar('mint_tx_hash', { length: 66 }),
    mintedAt: timestamp('minted_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('idx_drones_user_id').on(table.userId),
    levelIdx: index('idx_drones_level').on(table.level),
    activeIdx: index('idx_drones_active').on(table.active),
    isBotIdx: index('idx_drones_is_bot').on(table.isBot),
    eloIdx: index('idx_drones_elo_rating').on(table.eloRating),
  }),
);

/**
 * Drone-mod bindings. Represents a mod permanently attached to a drone's
 * collection. Multiple mods per drone allowed (collection); only one
 * is_equipped=true at a time per drone (enforced at the service layer).
 * Drones.appliedModId is a denormalized pointer to the equipped row's modId
 * for fast read on render paths.
 */
export const droneMods = pgTable(
  'drone_mods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    droneId: uuid('drone_id')
      .notNull()
      .references(() => drones.id, { onDelete: 'cascade' }),
    modId: uuid('mod_id')
      .notNull()
      .references(() => mods.id, { onDelete: 'cascade' }),
    isEquipped: boolean('is_equipped').notNull().default(false),
  },
  (table) => ({
    uniq: unique('uniq_drone_mod').on(table.droneId, table.modId),
    droneIdIdx: index('idx_drone_mods_drone_id').on(table.droneId),
    modIdIdx: index('idx_drone_mods_mod_id').on(table.modId),
  }),
);

/**
 * Drone-skin bindings. Mirrors droneMods. A skin permanently joins a
 * drone's collection on bind; multiple skins per drone allowed; exactly
 * one is_equipped=true at a time per drone (enforced at the service
 * layer). Drones.appliedSkinId is a denormalized pointer to the equipped
 * row's skinId for fast read on render paths.
 */
export const droneSkins = pgTable(
  'drone_skins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    droneId: uuid('drone_id')
      .notNull()
      .references(() => drones.id, { onDelete: 'cascade' }),
    skinId: uuid('skin_id')
      .notNull()
      .references(() => skins.id, { onDelete: 'cascade' }),
    isEquipped: boolean('is_equipped').notNull().default(false),
  },
  (table) => ({
    uniq: unique('uniq_drone_skin').on(table.droneId, table.skinId),
    droneIdIdx: index('idx_drone_skins_drone_id').on(table.droneId),
    skinIdIdx: index('idx_drone_skins_skin_id').on(table.skinId),
  }),
);

/**
 * Tracks - racing circuits that influence the race engine.
 *
 * `difficulty` is a 1–10 absolute rating (was 1–5 before the April 2026
 * data-model change). `levelMin` / `levelMax` define the inclusive player-
 * level bracket eligible for this track, so matchmaking never picks a
 * track that's outside a drone's level range.
 */
export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  straights: integer('straights').notNull(),
  turns: integer('turns').notNull(),
  laps: integer('laps').notNull().default(3),
  length: varchar('length', { length: 10 }).notNull(),
  difficulty: integer('difficulty').notNull(),
  levelMin: integer('level_min').notNull().default(1),
  levelMax: integer('level_max').notNull().default(20),
  imageUrl: text('image_url').notNull(),
});

/** Races - 1v1 races. Two-phase lifecycle:
 *
 *   PENDING   - matchmaking has paired the drones, picked the track
 *               and conditions, and snapshotted ELO; the race row
 *               carries `scheduled_at` (= matchmaking time + 3 min).
 *               winnerDroneId, drone{1,2}Time, raceLog, ELO change,
 *               and pointsAwarded are unset during this phase.
 *   COMPLETED - cron has executed the race; all result fields are
 *               populated; scheduled_at remains as the original
 *               schedule for historical reference.
 *
 * `drone{1,2}EloBefore` are snapshotted at PENDING creation and are
 * the canonical ELO for both display during the strategy window AND
 * the race-engine calculation at execution time.
 *
 * Default `status = 'completed'` so historical rows (created before
 * this column existed) are treated as completed without a backfill.
 */
export const races = pgTable(
  'races',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: varchar('status', { length: 15 }).notNull().default('completed'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    drone1Id: uuid('drone1_id')
      .notNull()
      .references(() => drones.id),
    drone2Id: uuid('drone2_id')
      .notNull()
      .references(() => drones.id),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id),
    winnerDroneId: uuid('winner_drone_id').references(() => drones.id),
    pointsAwarded: integer('points_awarded').notNull().default(0),
    /**
     * Loser's volts payout. Nullable because rows written before this
     * column existed have no recorded value; readers should fall back
     * to the loser-payout formula (see services/race.service.js
     * `computeLoserPayout`) when null.
     */
    loserPointsAwarded: integer('loser_points_awarded'),
    xpWinner: integer('xp_winner').notNull().default(10),
    xpLoser: integer('xp_loser').notNull().default(4),
    timeOfDay: varchar('time_of_day', { length: 10 }).notNull(),
    weather: varchar('weather', { length: 15 }).notNull(),
    drone1Time: decimal('drone1_time', { precision: 10, scale: 4 }),
    drone2Time: decimal('drone2_time', { precision: 10, scale: 4 }),
    drone1EloBefore: integer('drone1_elo_before').notNull().default(1000),
    drone2EloBefore: integer('drone2_elo_before').notNull().default(1000),
    drone1EloChange: integer('drone1_elo_change').notNull().default(0),
    drone2EloChange: integer('drone2_elo_change').notNull().default(0),
    raceLog: jsonb('race_log'),
  },
  (table) => ({
    drone1Idx: index('idx_races_drone1_id').on(table.drone1Id),
    drone2Idx: index('idx_races_drone2_id').on(table.drone2Id),
    createdAtIdx: index('idx_races_created_at').on(table.createdAt),
    winnerIdx: index('idx_races_winner_drone_id').on(table.winnerDroneId),
    statusIdx: index('idx_races_status').on(table.status),
    scheduledAtIdx: index('idx_races_scheduled_at').on(table.scheduledAt),
  }),
);

/** Marketplace listings - drone and skin sales. */
export const marketplaceListings = pgTable(
  'marketplace_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    itemType: varchar('item_type', { length: 10 }).notNull(),
    droneId: uuid('drone_id').references(() => drones.id),
    skinId: uuid('skin_id').references(() => skins.id),
    modId: uuid('mod_id').references(() => mods.id),
    price: integer('price').notNull(),
    status: varchar('status', { length: 15 }).notNull().default('active'),
    buyerId: uuid('buyer_id').references(() => users.id),
    soldAt: timestamp('sold_at', { withTimezone: true }),
    platformFee: integer('platform_fee'),
  },
  (table) => ({
    statusIdx: index('idx_marketplace_status').on(table.status),
    itemTypeIdx: index('idx_marketplace_item_type').on(table.itemType),
    sellerIdIdx: index('idx_marketplace_seller_id').on(table.sellerId),
    buyerIdIdx: index('idx_marketplace_buyer_id').on(table.buyerId),
  }),
);

/** Drone ownership history - audit log for drone transfers. */
export const droneOwnershipHistory = pgTable(
  'drone_ownership_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    droneId: uuid('drone_id')
      .notNull()
      .references(() => drones.id),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    startDate: timestamp('start_date', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endDate: timestamp('end_date', { withTimezone: true }),
    transactionType: varchar('transaction_type', { length: 20 }),
    pricePaid: integer('price_paid'),
  },
  (table) => ({
    droneIdIdx: index('idx_ownership_drone_id').on(table.droneId),
  }),
);

/** Seasons - competitive season windows. */
export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonNumber: integer('season_number').notNull().unique(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  isActive: boolean('is_active').notNull().default(false),
});

/** Admin config - key-value store for tunable game parameters. */
export const adminConfig = pgTable('admin_config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
