/**
 * Gameplay tables added after the baseline (SPEC.md 7): pack opens with their sealed commit-reveal
 * secret, the fixed-window rate limit counters (T10) and the catalog cache (T13). Re-exported from
 * `schema.js`, so drizzle-kit and `db` see them with the rest of the schema.
 */
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
  jsonb,
} from 'drizzle-orm/pg-core';
import { users } from './schema.js';

/** pack_opens.status: secret sealed, `open_pack` applied, `reveal_pack` applied. */
export const PACK_OPEN_STATES = /** @type {const} */ (['pending', 'committed', 'revealed']);
export const packOpenStatusEnum = pgEnum('pack_open_status', PACK_OPEN_STATES);

/**
 * One row per pack or capsule open (SPEC.md 4.4 `open_pack` / `reveal_pack`). The row and its
 * sealed secret exist before `open_pack` is sent, so a crash between the commit and the reveal
 * never loses the burned Volts: replaying the same action id resumes from `committed`.
 * `secret_enc` is sealed with `KEY_ENCRYPTION_KEY`, AAD = the action id.
 */
export const packOpens = pgTable(
  'pack_opens',
  {
    actionId: uuid('action_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    packId: bigint('pack_id', { mode: 'number' }).unique(),
    kind: varchar('kind', { length: 4 }).notNull(),
    tier: smallint('tier').notNull(),
    secretEnc: text('secret_enc').notNull(),
    status: packOpenStatusEnum('status').notNull().default('pending'),
    commitTx: varchar('commit_tx', { length: 64 }),
    revealTx: varchar('reveal_tx', { length: 64 }),
    tokens: jsonb('tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_pack_opens_user_id').on(table.userId),
  })
);

/**
 * Fixed-window request counters shared by every serverless instance (ENGINEERING.md 4). `bucket`
 * names the limit and its subject (`mutation:<userId>`, `demo:<ipHash>`); one row per window.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.bucket, table.windowStart] }),
  })
);

/**
 * Wallet-link challenges (SPEC.md 7, 8): a 32-byte nonce bound to a user, single use, 5-minute
 * expiry. `used_at` and `wallet` are set when a signature claims the challenge; `linked_at` when
 * the chain holds the link. A claimed challenge can only finish its own link.
 */
export const walletChallenges = pgTable(
  'wallet_challenges',
  {
    nonce: varchar('nonce', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    recipient: text('recipient').notNull(),
    wallet: varchar('wallet', { length: 64 }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_wallet_challenges_user_id').on(table.userId),
  })
);

/**
 * Cache of the contract's `get_catalog()` (SPEC.md 2.5, 2.6, 4.5), written by the world seed: one
 * row per skin or mod template. `cap` is a skin's supply cap, null for Ember (uncapped) and for
 * every mod (unlimited). Minted counts are not cached; they change with every mint and live on
 * chain. `data` holds a skin's `{ slug, file }` or a mod's bonus, penalty and special.
 */
export const catalogTemplates = pgTable(
  'catalog_templates',
  {
    kind: varchar('kind', { length: 4 }).notNull(),
    template: smallint('template').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    rarity: varchar('rarity', { length: 15 }).notNull(),
    imageUrl: text('image_url'),
    cap: integer('cap'),
    data: jsonb('data'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.kind, table.template] }),
  })
);
