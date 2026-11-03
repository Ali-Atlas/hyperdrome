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
  pgEnum,
  smallint,
  bigint,
} from 'drizzle-orm/pg-core';
import { calculateXPToNextLevel } from '../game-engine/economy.js';

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
/** users.bootstrap_state values, in order (SPEC.md 12). */
export const BOOTSTRAP_STATES = /** @type {const} */ (['none', 'account', 'minted', 'done']);
export const bootstrapStateEnum = pgEnum('bootstrap_state', BOOTSTRAP_STATES);
export const batchStatusEnum = pgEnum('batch_status', ['committed', 'settled', 'failed']);
export const actionStatusEnum = pgEnum('action_status', ['pending', 'applied', 'failed']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  // NEAR player account (SPEC.md 7). Keys are sealed by lib/near (AES-256-GCM, AAD = account id).
  nearAccountId: varchar('near_account_id', { length: 64 }).unique(),
  playKeyEnc: text('play_key_enc'),
  adminKeyEnc: text('admin_key_enc'),
  keyVersion: integer('key_version'),
  isTeam: boolean('is_team').notNull().default(false),
  teamPersona: jsonb('team_persona'),
  // Bootstrap state machine (services/bootstrap.service.js). bootstrap_pending holds the sealed
  // keys of create_player attempts whose outcome is unknown (SPEC.md 6), until one is resolved.
  // bootstrap_claimed_at is the lease that stops two requests from acting at once.
  bootstrapState: bootstrapStateEnum('bootstrap_state').notNull().default('none'),
  bootstrapPending: jsonb('bootstrap_pending'),
  bootstrapClaimedAt: timestamp('bootstrap_claimed_at', { withTimezone: true }),
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
  })
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
  })
);

/**
 * Skins - cosmetic only. userId null = unowned pool for drops/seeding.
 * rarity is 'common' | 'rare' | 'epic' | 'legendary' (app-validated).
 */
export const skins = pgTable(
  'skins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 100 }).notNull(),
    rarity: varchar('rarity', { length: 15 }).notNull(),
    imageUrl: text('image_url').notNull(),
    description: text('description'),
    // On-chain token (SPEC.md 4.2): template id (1-based, 2.5 / 2.6 order) and token id `s:<n>` or
    // `m:<n>`. Bound and equipped state is cached in drone_skins / drone_mods.
    template: smallint('template'),
    tokenId: varchar('token_id', { length: 32 }).unique(),
    chainSyncedAt: timestamp('chain_synced_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('idx_skins_user_id').on(table.userId),
    rarityIdx: index('idx_skins_rarity').on(table.rarity),
  })
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    // On-chain token (SPEC.md 4.2): template id (1-based, 2.5 / 2.6 order) and token id `s:<n>` or
    // `m:<n>`. Bound and equipped state is cached in drone_skins / drone_mods.
    template: smallint('template'),
    tokenId: varchar('token_id', { length: 32 }).unique(),
    chainSyncedAt: timestamp('chain_synced_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('idx_mods_user_id').on(table.userId),
    rarityIdx: index('idx_mods_rarity').on(table.rarity),
  })
);

/** Drones - individual racers. Owned by users or marked as bots. */
export const drones = pgTable(
  'drones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 100 }).notNull(),
    level: integer('level').notNull().default(1),
    xp: integer('xp').notNull().default(0),
    xpToNextLevel: integer('xp_to_next_level').notNull().default(calculateXPToNextLevel(1)),
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
    // On-chain token id `d:<n>` (SPEC.md 4.2). Stats, level, xp, elo, wins, losses, equipped and
    // bound items are caches of the contract, refreshed from outcomes and events.
    tokenId: varchar('token_id', { length: 32 }).unique(),
    chainSyncedAt: timestamp('chain_synced_at', { withTimezone: true }),
  },
  (table) => ({
    userIdIdx: index('idx_drones_user_id').on(table.userId),
    levelIdx: index('idx_drones_level').on(table.level),
    activeIdx: index('idx_drones_active').on(table.active),
    isBotIdx: index('idx_drones_is_bot').on(table.isBot),
    eloIdx: index('idx_drones_elo_rating').on(table.eloRating),
  })
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  })
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  })
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    // Batch settlement (SPEC.md 6, 7): slot and index give raceId `<slot>:<index>`; seed and
    // snapshots are public once settled, for replay; log is the client-safe engine log.
    batchSlot: bigint('batch_slot', { mode: 'number' }),
    raceIndex: integer('race_index'),
    seed: varchar('seed', { length: 64 }),
    snapshotA: jsonb('snapshot_a'),
    snapshotB: jsonb('snapshot_b'),
    settleTx: varchar('settle_tx', { length: 64 }),
    log: jsonb('log'),
  },
  (table) => ({
    drone1Idx: index('idx_races_drone1_id').on(table.drone1Id),
    drone2Idx: index('idx_races_drone2_id').on(table.drone2Id),
    createdAtIdx: index('idx_races_created_at').on(table.createdAt),
    winnerIdx: index('idx_races_winner_drone_id').on(table.winnerDroneId),
    statusIdx: index('idx_races_status').on(table.status),
    scheduledAtIdx: index('idx_races_scheduled_at').on(table.scheduledAt),
    batchIdx: unique('uniq_races_batch_race').on(table.batchSlot, table.raceIndex),
  })
);

/** Marketplace listings - drone and skin sales. */
export const marketplaceListings = pgTable(
  'marketplace_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  })
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
    startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
    endDate: timestamp('end_date', { withTimezone: true }),
    transactionType: varchar('transaction_type', { length: 20 }),
    pricePaid: integer('price_paid'),
  },
  (table) => ({
    droneIdIdx: index('idx_ownership_drone_id').on(table.droneId),
  })
);

/** Seasons - competitive season windows. */
export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonNumber: integer('season_number').notNull().unique(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  isActive: boolean('is_active').notNull().default(false),
});

export const adminConfig = pgTable('admin_config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Race batches (SPEC.md 6, 7). seed_enc is sealed until settled, then seed is stored plain. */
export const batches = pgTable('batches', {
  slot: bigint('slot', { mode: 'number' }).primaryKey(),
  seedHash: varchar('seed_hash', { length: 64 }).notNull(),
  seedEnc: text('seed_enc'),
  seed: varchar('seed', { length: 64 }),
  status: batchStatusEnum('status').notNull().default('committed'),
  commitTx: varchar('commit_tx', { length: 64 }),
  settleTxs: jsonb('settle_txs'),
  committedAt: timestamp('committed_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
});

/** One row per scheduler tick slot; the unique key is the tick guard (SPEC.md 3). */
export const cronTicks = pgTable('cron_ticks', {
  slot: bigint('slot', { mode: 'number' }).primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Player chain actions, for action_id idempotency and seq recovery (SPEC.md 7, 8). */
export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 40 }).notNull(),
    seq: bigint('seq', { mode: 'number' }),
    args: jsonb('args'),
    txHash: varchar('tx_hash', { length: 64 }),
    status: actionStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_actions_user_id').on(table.userId),
  })
);

/**
 * Demo sign-ups (SPEC.md 12), for the per-IP limit across serverless instances. `ip_hash` is
 * sha256(AUTH_SECRET ++ ip); the raw IP is never stored.
 */
export const demoSignups = pgTable(
  'demo_signups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipHash: varchar('ip_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ipHashCreatedIdx: index('idx_demo_signups_ip_hash_created_at').on(
      table.ipHash,
      table.createdAt
    ),
  })
);

/** AI teams (SPEC.md 10). reserve is a Volts amount, so it is stored as text (u128). */
export const teams = pgTable('teams', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 50 }).notNull(),
  persona: jsonb('persona'),
  reserve: text('reserve'),
});
