/**
 * Production seed script. Run via:
 *   npm run seed:prod                  (idempotent additive seed)
 *   npm run seed:prod -- --fresh       (TRUNCATE first, then seed)
 *
 * The `--fresh` flag wipes the same set of tables that the dev wrapper
 * truncates (preserves tracks, seasons, admin_config) so the seed runs
 * against an empty player/inventory/race state. The "Type YES" gate
 * still runs.
 *
 * Reads PROD_DATABASE_URL out of .env.local (loaded by `node --env-file`)
 * and seeds the live database in idempotent sections:
 *
 *   A. admin_config (7 keys, racing_enabled=false; Captain flips manually)
 *   B. bot users (BOT_ALPHA/BETA/GAMMA + MKT_PULSE/NEXUS/ORBIT)
 *   C. racing bot drones (24, owned by BOT_* users)
 *   D. tracks (16, name-keyed; insert-only — manual prod tweaks survive)
 *   E. skin vault (~814 rows: 744 image-backed + 70 placeholders;
 *      sized for heavy demo pack purchasing across 50 demo accounts)
 *   F. mod vault (~776 rows: 26 templates + 750 vault copies)
 *   G. marketplace listings (~100, sold by MKT_* users)
 *   H. demo accounts PILOT_D01..D50 via scripts/seed-demo-player.js
 *
 * Every section reports a row-count delta so the operator can see what
 * the pass actually changed. Re-running is safe.
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import readline from 'node:readline';

import * as schema from '../lib/db/schema.js';
import { seedDemoAccount } from './seed-demo-player.js';
import { generateUniqueDroneName } from '../lib/game-engine/drone-names.js';

const {
  users,
  drones,
  skins,
  mods,
  tracks,
  seasons,
  adminConfig,
  marketplaceListings,
} = schema;

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * URL resolution: production runs read PROD_DATABASE_URL. The dev wrapper
 * (scripts/seed-dev.js) runs the same seed against the local DB; it sets
 * ALLOW_LOCAL_SEED=1 and we fall through to DATABASE_URL. The flag is
 * required because dropping into DATABASE_URL silently would let
 * `npm run seed:prod` accidentally hit a local DB if PROD_DATABASE_URL
 * is missing - keep that fail-closed.
 */
const RESOLVED_URL =
  process.env.PROD_DATABASE_URL ??
  (process.env.ALLOW_LOCAL_SEED === '1' ? process.env.DATABASE_URL : null);
if (!RESOLVED_URL) {
  console.error(
    'PROD_DATABASE_URL is not set. Add it to .env.local and re-run with `npm run seed:prod` (or use `npm run seed:dev` for the local DB).',
  );
  process.exit(1);
}

export const db = drizzle(neon(RESOLVED_URL), { schema });

async function confirmProd() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise((resolve) => {
    rl.question(
      'About to seed PRODUCTION database. Type YES to continue: ',
      (a) => resolve(a),
    );
  });
  rl.close();
  if (answer !== 'YES') {
    console.log('Aborted.');
    process.exit(0);
  }
}

/* -------------------------------------------------------------------------- */
/* --fresh truncate                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Tables wiped by `--fresh`. Mirrors scripts/seed-dev.js — preserves
 * `tracks`, `seasons`, and `admin_config` so manual prod tweaks to those
 * reference tables aren't blown away by a reseed.
 */
const FRESH_TRUNCATE_TABLES = [
  'races',
  'marketplace_listings',
  'drone_skins',
  'drone_mods',
  'drone_ownership_history',
  'drones',
  'skins',
  'mods',
  'accounts',
  'sessions',
  'verification_token',
  'users',
];

async function truncateForFresh() {
  const list = FRESH_TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  console.log(
    `[fresh] Truncating ${FRESH_TRUNCATE_TABLES.length} tables (RESTART IDENTITY CASCADE)...`,
  );
  // sql.raw is intentional: the table list is hardcoded above, not user
  // input. TRUNCATE doesn't accept value parameters, only identifiers.
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`));
  console.log('[fresh] Truncate complete.\n');
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const STAT_KEYS = [
  'speed',
  'turning',
  'acceleration',
  'durability',
  'nightVision',
  'batteryCapacity',
  'rainHandling',
  'windResistance',
  'consistency',
];

const TSB_BASE = 9;
const TSB_PER_LEVEL = 20;
const STAT_CAP_BASE = 10;
const STAT_CAP_PER_LEVEL = 4.5;

const BOT_PROFILES = {
  balanced:    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  speedster:   [3, 1, 3, 1, 1, 1, 1, 3, 1],
  cornerer:    [1, 4, 1, 2, 1, 1, 1, 1, 2],
  tank:        [1, 1, 1, 4, 1, 2, 1, 1, 2],
  nightHunter: [2, 1, 1, 1, 4, 1, 1, 1, 1],
  rainRider:   [1, 2, 1, 1, 1, 1, 4, 1, 2],
  windWalker:  [2, 1, 2, 1, 1, 1, 1, 4, 1],
  marathoner:  [2, 1, 1, 2, 1, 4, 1, 1, 1],
  consistent:  [1, 2, 1, 1, 1, 1, 1, 1, 5],
  allrounder:  [2, 2, 2, 2, 1, 1, 1, 1, 2],
};

/**
 * Marketplace drone pricing tier table. Price scales linearly with level
 * inside the tier band (4 steps across the 5-level span) plus a ±15%
 * random variance so two same-level drones don't list identical. The
 * NPC vendor sells LV1 drones at 3,500V, so even T1 starts above that
 * to reflect the leveling work a marketplace drone has already done.
 *
 *   T1 (LV 1-5):    5,000 - 15,000V
 *   T2 (LV 6-10):   40,000 - 90,000V
 *   T3 (LV 11-15):  150,000 - 300,000V
 *   T4 (LV 16-20):  400,000 - 750,000V
 *
 * Update both ends in lockstep with scripts/fix-marketplace-featured.js
 * if these tiers ever shift (legacy script mirrors the same numbers).
 */
const PRICE_TIERS = [
  { min: 1,  max: 5,  base:   5_000, top:  15_000 },
  { min: 6,  max: 10, base:  40_000, top:  90_000 },
  { min: 11, max: 15, base: 150_000, top: 300_000 },
  { min: 16, max: 20, base: 400_000, top: 750_000 },
];

function priceForLevel(level) {
  const tier = PRICE_TIERS.find((t) => level >= t.min && level <= t.max);
  if (!tier) return 5_000; // Out-of-range fallback; LV0 / LV21+ shouldn't occur.
  const span = tier.max - tier.min; // 4 (5-level tier).
  const linear =
    span === 0
      ? tier.base
      : tier.base + ((tier.top - tier.base) * (level - tier.min)) / span;
  // ±15% variance keeps prices from clustering at the level-derived
  // value. Clamp the result back into the stated tier band so the
  // variance can't push a top-of-tier roll past the published ceiling
  // (a LV20 + 15% would otherwise list above 750K).
  const variance = 0.85 + Math.random() * 0.3;
  const raw = Math.round(linear * variance);
  return Math.max(tier.base, Math.min(tier.top, raw));
}

function buildStats(level, profileName) {
  const tsb = TSB_BASE + TSB_PER_LEVEL * level;
  const cap = Math.min(100, STAT_CAP_BASE + Math.floor(STAT_CAP_PER_LEVEL * level));
  const points = tsb - 9;
  const weights = BOT_PROFILES[profileName] ?? BOT_PROFILES.balanced;
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 1]));
  let assigned = 0;
  for (let i = 0; i < STAT_KEYS.length; i++) {
    const share = Math.floor((points * weights[i]) / totalWeight);
    stats[STAT_KEYS[i]] = Math.min(cap, 1 + share);
    assigned += stats[STAT_KEYS[i]] - 1;
  }
  let remaining = points - assigned;
  let guard = 0;
  while (remaining > 0 && guard < 100) {
    let placed = 0;
    for (let k = 0; k < STAT_KEYS.length && remaining > 0; k++) {
      if (stats[STAT_KEYS[k]] < cap) {
        stats[STAT_KEYS[k]] += 1;
        remaining -= 1;
        placed += 1;
      }
    }
    if (placed === 0) break;
    guard += 1;
  }
  return { stats, tsb };
}

/* -------------------------------------------------------------------------- */
/* A. admin_config                                                            */
/* -------------------------------------------------------------------------- */

const ADMIN_CONFIG_ROWS = [
  ['racing_enabled',         'false', 'Master switch (Captain flips manually post-seed)'],
  ['race_interval_seconds',  '180',   'Seconds between race cycles'],
  ['points_per_win_base',    '3',     'Base points awarded to race winner'],
  ['points_per_loss_base',   '1',     'Base points awarded to race loser'],
  ['xp_per_win',             '10',    'XP awarded to race winner'],
  ['xp_per_loss',             '4',    'XP awarded to race loser'],
  ['bot_density_minimum',    '5',     'Minimum bots per bracket for matchmaking'],
];

async function seedAdminConfig() {
  const rows = ADMIN_CONFIG_ROWS.map(([key, value, description]) => ({
    key,
    value,
    description,
  }));
  await db.insert(adminConfig).values(rows).onConflictDoNothing();
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* B. bot users                                                               */
/* -------------------------------------------------------------------------- */

const BOT_USERS = [
  // Racing bot owners. activeDroneSlots set high enough to hold the
  // bracket roster (Captain B answer overrides the "3 active per bot
  // user" guideline so each bracket has the spec'd 6+ active bots).
  { username: 'BOT_ALPHA', email: 'bot_alpha@hyperdrome.bot', activeDroneSlots: 8 },
  { username: 'BOT_BETA',  email: 'bot_beta@hyperdrome.bot',  activeDroneSlots: 8 },
  { username: 'BOT_GAMMA', email: 'bot_gamma@hyperdrome.bot', activeDroneSlots: 12 },
  // Marketplace listing owners. Don't race - keep slots default.
  { username: 'MKT_PULSE', email: 'mkt_pulse@hyperdrome.bot', activeDroneSlots: 1 },
  { username: 'MKT_NEXUS', email: 'mkt_nexus@hyperdrome.bot', activeDroneSlots: 1 },
  { username: 'MKT_ORBIT', email: 'mkt_orbit@hyperdrome.bot', activeDroneSlots: 1 },
];

async function seedBotUsers() {
  let inserted = 0;
  for (const u of BOT_USERS) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, u.email))
      .limit(1);
    if (existing) continue;
    await db.insert(users).values({
      username: u.username,
      name: u.username,
      email: u.email,
      emailVerified: new Date(),
      activeDroneSlots: u.activeDroneSlots,
    });
    inserted += 1;
  }
  return inserted;
}

async function getBotUserMap() {
  const rows = await db
    .select()
    .from(users)
    .where(inArray(users.email, BOT_USERS.map((u) => u.email)));
  return Object.fromEntries(rows.map((r) => [r.username, r]));
}

/* -------------------------------------------------------------------------- */
/* C. racing bot drones                                                       */
/* -------------------------------------------------------------------------- */

/* 24 racing bots: 6 per bracket, 4 brackets. BOT_ALPHA owns bracket 1
 * (lvl 1-5), BOT_BETA owns bracket 2 (lvl 6-10), BOT_GAMMA owns
 * brackets 3 + 4 (lvl 11-20). All active=true, isBot=true. */
const RACING_BOTS = [
  // Bracket 1 — owner BOT_ALPHA
  { name: 'PHANTOM-X1', level: 1, profile: 'balanced',   owner: 'BOT_ALPHA' },
  { name: 'SHADOW-R3',  level: 2, profile: 'speedster',  owner: 'BOT_ALPHA' },
  { name: 'VIPER-K7',   level: 3, profile: 'cornerer',   owner: 'BOT_ALPHA' },
  { name: 'ECHO-M4',    level: 4, profile: 'tank',       owner: 'BOT_ALPHA' },
  { name: 'PULSE-D9',   level: 4, profile: 'consistent', owner: 'BOT_ALPHA' },
  { name: 'NOVA-B2',    level: 5, profile: 'allrounder', owner: 'BOT_ALPHA' },
  // Bracket 2 — owner BOT_BETA
  { name: 'HAWK-W4',    level: 6,  profile: 'speedster',   owner: 'BOT_BETA' },
  { name: 'BLADE-Z7',   level: 7,  profile: 'cornerer',    owner: 'BOT_BETA' },
  { name: 'FANG-H3',    level: 8,  profile: 'tank',        owner: 'BOT_BETA' },
  { name: 'DART-C9',    level: 8,  profile: 'windWalker',  owner: 'BOT_BETA' },
  { name: 'BOLT-P5',    level: 9,  profile: 'marathoner',  owner: 'BOT_BETA' },
  { name: 'RAGE-Q2',    level: 10, profile: 'rainRider',   owner: 'BOT_BETA' },
  // Bracket 3 — owner BOT_GAMMA
  { name: 'FURY-N6',    level: 11, profile: 'nightHunter', owner: 'BOT_GAMMA' },
  { name: 'APEX-V8',    level: 12, profile: 'consistent',  owner: 'BOT_GAMMA' },
  { name: 'ZERO-G0',    level: 13, profile: 'allrounder',  owner: 'BOT_GAMMA' },
  { name: 'OMEGA-X9',   level: 13, profile: 'speedster',   owner: 'BOT_GAMMA' },
  { name: 'SIGMA-T2',   level: 14, profile: 'cornerer',    owner: 'BOT_GAMMA' },
  { name: 'KAPPA-L1',   level: 15, profile: 'rainRider',   owner: 'BOT_GAMMA' },
  // Bracket 4 — owner BOT_GAMMA
  { name: 'DELTA-Z4',   level: 16, profile: 'tank',        owner: 'BOT_GAMMA' },
  { name: 'EPSILON-P7', level: 17, profile: 'speedster',   owner: 'BOT_GAMMA' },
  { name: 'ZETA-M3',    level: 17, profile: 'nightHunter', owner: 'BOT_GAMMA' },
  { name: 'ETA-W6',     level: 18, profile: 'windWalker',  owner: 'BOT_GAMMA' },
  { name: 'THETA-C8',   level: 19, profile: 'marathoner',  owner: 'BOT_GAMMA' },
  { name: 'IOTA-V0',    level: 20, profile: 'allrounder',  owner: 'BOT_GAMMA' },
];

async function seedRacingBots(botUserMap) {
  let inserted = 0;
  for (const def of RACING_BOTS) {
    const owner = botUserMap[def.owner];
    if (!owner) continue;
    // Idempotency: skip if a drone with this name already exists owned by
    // this bot user.
    const [existing] = await db
      .select()
      .from(drones)
      .where(and(eq(drones.userId, owner.id), eq(drones.name, def.name)))
      .limit(1);
    if (existing) continue;

    const { stats, tsb } = buildStats(def.level, def.profile);
    await db.insert(drones).values({
      userId: owner.id,
      name: def.name,
      level: def.level,
      xp: 0,
      xpToNextLevel: 300 * def.level * def.level,
      totalStatBudget: tsb,
      ...stats,
      active: true,
      isBot: true,
      eloRating: 1000 + randInt(-50, 50),
      imageUrl: '/drones/default.png',
    });
    inserted += 1;
  }
  return inserted;
}

/* -------------------------------------------------------------------------- */
/* D. tracks                                                                  */
/* -------------------------------------------------------------------------- */

const TRACK_DATA = [
  { name: 'Horizon Express',   levelMin: 1,  levelMax: 5,  difficulty: 1,  straights: 2, turns: 2,  laps: 3, length: 'short'  },
  { name: 'Neon Straightaway', levelMin: 1,  levelMax: 5,  difficulty: 2,  straights: 3, turns: 3,  laps: 3, length: 'medium' },
  { name: 'Keyhole',           levelMin: 1,  levelMax: 5,  difficulty: 2,  straights: 2, turns: 2,  laps: 3, length: 'short'  },
  { name: 'The Grid',          levelMin: 1,  levelMax: 5,  difficulty: 3,  straights: 4, turns: 4,  laps: 3, length: 'medium' },
  { name: 'Meridian',          levelMin: 6,  levelMax: 10, difficulty: 3,  straights: 4, turns: 4,  laps: 3, length: 'medium' },
  { name: 'Circuit Alpha',     levelMin: 6,  levelMax: 10, difficulty: 4,  straights: 4, turns: 5,  laps: 3, length: 'medium' },
  { name: 'Crossfire',         levelMin: 6,  levelMax: 10, difficulty: 4,  straights: 3, turns: 5,  laps: 3, length: 'medium' },
  { name: 'Iron Ribbon',       levelMin: 6,  levelMax: 10, difficulty: 5,  straights: 4, turns: 6,  laps: 3, length: 'long'   },
  { name: 'Skyline Drift',     levelMin: 11, levelMax: 15, difficulty: 6,  straights: 3, turns: 7,  laps: 3, length: 'long'   },
  { name: 'Helix',             levelMin: 11, levelMax: 15, difficulty: 6,  straights: 2, turns: 6,  laps: 3, length: 'medium' },
  { name: 'Switchblade',       levelMin: 11, levelMax: 15, difficulty: 7,  straights: 3, turns: 8,  laps: 3, length: 'long'   },
  { name: 'Phantom Circuit',   levelMin: 11, levelMax: 15, difficulty: 7,  straights: 4, turns: 7,  laps: 3, length: 'long'   },
  { name: 'Voltage Loop',      levelMin: 16, levelMax: 20, difficulty: 8,  straights: 4, turns: 8,  laps: 3, length: 'long'   },
  { name: 'Obsidian Maze',     levelMin: 16, levelMax: 20, difficulty: 9,  straights: 3, turns: 9,  laps: 3, length: 'long'   },
  { name: 'Apex Descent',      levelMin: 16, levelMax: 20, difficulty: 9,  straights: 2, turns: 10, laps: 3, length: 'long'   },
  { name: 'Tempest Run',       levelMin: 16, levelMax: 20, difficulty: 10, straights: 2, turns: 8,  laps: 3, length: 'long'   },
];

function trackImagePath(name) {
  return `/tracks/${name.toLowerCase().trim().replace(/\s+/g, '_')}.webp`;
}

async function seedTracks() {
  // Insert-only: if a track with this name exists, leave it alone so any
  // manual edits in prod (difficulty tweaks, lap count changes, image
  // overrides) survive a reseed. Adding a new track to TRACK_DATA still
  // gets picked up on the next run.
  let inserted = 0;
  let skipped = 0;
  for (const t of TRACK_DATA) {
    const [existing] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.name, t.name))
      .limit(1);
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.insert(tracks).values({ ...t, imageUrl: trackImagePath(t.name) });
    inserted += 1;
  }
  return { inserted, skipped };
}

async function seedSeasonOne() {
  const [existing] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.seasonNumber, 1))
    .limit(1);
  if (existing) return 0;
  const now = new Date();
  await db.insert(seasons).values({
    seasonNumber: 1,
    startDate: now,
    endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    isActive: true,
  });
  return 1;
}

/* -------------------------------------------------------------------------- */
/* E. skin vault                                                              */
/* -------------------------------------------------------------------------- */

/* Image-backed catalog: 8 per rarity, paths match webps in public/skins/. */
const IMAGE_BACKED_SKINS = [
  // Commons
  { name: 'Bone',        rarity: 'common',    imageUrl: '/skins/common/bone.webp' },
  { name: 'Cobalt',      rarity: 'common',    imageUrl: '/skins/common/cobalt.webp' },
  { name: 'Dusk',        rarity: 'common',    imageUrl: '/skins/common/dusk.webp' },
  { name: 'Ember',       rarity: 'common',    imageUrl: '/skins/common/ember.webp' },
  { name: 'Frost',       rarity: 'common',    imageUrl: '/skins/common/frost.webp' },
  { name: 'Rust',        rarity: 'common',    imageUrl: '/skins/common/rust.webp' },
  { name: 'Shadow',      rarity: 'common',    imageUrl: '/skins/common/shadow.webp' },
  { name: 'Venom',       rarity: 'common',    imageUrl: '/skins/common/venom.webp' },
  // Rares
  { name: 'Anodized Blaze', rarity: 'rare',   imageUrl: '/skins/rare/anodized_blaze.webp' },
  { name: 'Arctic Fury',    rarity: 'rare',   imageUrl: '/skins/rare/arctic_fury.webp' },
  { name: 'Chrome Fury',    rarity: 'rare',   imageUrl: '/skins/rare/chrome_fury.webp' },
  { name: 'Copper King',    rarity: 'rare',   imageUrl: '/skins/rare/copper_king.webp' },
  { name: 'Gunmetal Storm', rarity: 'rare',   imageUrl: '/skins/rare/gunmetal_storm.webp' },
  { name: 'Jade Circuit',   rarity: 'rare',   imageUrl: '/skins/rare/jade_circuit.webp' },
  { name: 'Midnight Oil',   rarity: 'rare',   imageUrl: '/skins/rare/midnight_oil.webp' },
  { name: 'Titanium Ghost', rarity: 'rare',   imageUrl: '/skins/rare/titanium_ghost.webp' },
  // Epics
  { name: 'Crystal Phantom',    rarity: 'epic', imageUrl: '/skins/epic/crystal_phantom.webp' },
  { name: 'Dragon Scale',       rarity: 'epic', imageUrl: '/skins/epic/dragon_scale.webp' },
  { name: 'Frozen Abyss',       rarity: 'epic', imageUrl: '/skins/epic/frozen_abyss.webp' },
  { name: 'Iridescent Wraith',  rarity: 'epic', imageUrl: '/skins/epic/iridescent_wraith.webp' },
  { name: 'Liquid Mercury',     rarity: 'epic', imageUrl: '/skins/epic/liquid_mercury.webp' },
  { name: 'Obsidian Core',      rarity: 'epic', imageUrl: '/skins/epic/obsidian_core.webp' },
  { name: 'Solar Flare',        rarity: 'epic', imageUrl: '/skins/epic/solar_flare.webp' },
  { name: 'Void Bloom',         rarity: 'epic', imageUrl: '/skins/epic/void_bloom.webp' },
  // Legendaries (Captain D answer: all 8)
  { name: 'Apex Predator', rarity: 'legendary', imageUrl: '/skins/legendary/apex_predator.webp' },
  { name: 'Celestial',     rarity: 'legendary', imageUrl: '/skins/legendary/celestial.webp' },
  { name: 'Diamond Hands', rarity: 'legendary', imageUrl: '/skins/legendary/diamond_hand.webp' },
  { name: 'Gilded Throne', rarity: 'legendary', imageUrl: '/skins/legendary/gilded_throne.webp' },
  { name: 'Kraken',        rarity: 'legendary', imageUrl: '/skins/legendary/kraken.webp' },
  { name: 'Necromancer',   rarity: 'legendary', imageUrl: '/skins/legendary/necromancer.webp' },
  { name: 'Samurai',       rarity: 'legendary', imageUrl: '/skins/legendary/samurai.webp' },
  { name: 'Valiant',       rarity: 'legendary', imageUrl: '/skins/legendary/valiant.webp' },
];

/* 70 placeholder skins: rarity-distributed, no real image (the path is
 * intentional: marketplace + drone-equip code already detects the
 * non-/skins/ prefix and renders a placeholder swatch).
 *
 * Names come from PLACEHOLDER_NAME_POOLS below. The pool per rarity is
 * sourced from the dev seed (lib/db/seed.js#SKIN_NAMES) plus curated
 * overflow names where the placeholder count exceeds the dev pool. The
 * imageUrl path stays `/placeholder/legacy_NNN.png` as the durable
 * marker that identifies these rows for the idempotency check below
 * and for fallback-render code in marketplace/drone-equip. */
const PLACEHOLDER_RARITY_SPLIT = [
  { rarity: 'common', count: 28 },
  { rarity: 'rare',   count: 24 },
  { rarity: 'epic',   count: 14 },
  { rarity: 'legendary', count: 4 },
];

/* Name pool per rarity. If the placeholder count exceeds the pool, the
 * generator wraps with `pool[i % pool.length]`, so the same name can
 * appear on multiple placeholder rows. That's already how vault copies
 * share names (the schema allows duplicate names by design).
 *
 * The pool is kept in sync with scripts/rename-legacy-skins-prod.js (a
 * one-shot script that renames any existing Legacy-prefixed rows in the
 * prod DB to themed names from this same source). */
const PLACEHOLDER_NAME_POOLS = {
  common: [
    'Carbon Fiber', 'Gunmetal', 'Stealth Gray', 'Arctic White', 'Obsidian',
    'Matte Black', 'Brushed Steel', 'Copper Plate', 'Navy Blue', 'Forest Green',
    'Desert Tan', 'Slate Gray', 'Rust Patina', 'Industrial Iron', 'Concrete',
    'Military Olive', 'Plasma Gray', 'Alloy Silver', 'Chrome Plate', 'Warning Yellow',
    'Flare Orange', 'Ember Red', 'Cool Blue', 'Stormcloud', 'Midnight Black',
    'Ash Gray', 'Riveted Steel', 'Bronze Plating', 'Aluminum Finish', 'Coal Matte',
  ],
  rare: [
    'Neon Pulse', 'Cyber Stripe', 'Electric Blue', 'Hologram', 'Signal Red',
    'Grid Runner', 'Data Stream', 'Binary Wave', 'Tron Line', 'Synthwave',
    'Laser Mesh', 'Circuit Board', 'Prism', 'Quantum Weave', 'Plasma Core',
    'Phantom Edge', 'Iron Veil', 'Cobalt Strike', 'Static Drift', 'Mirror Coil',
    'Spectral Mesh', 'Voltage Husk', 'Ion Lattice', 'Nova Burst',
  ],
  epic: [
    'Inferno Phoenix', 'Tidal Surge', 'Thunder Strike', 'Void Walker',
    'Blizzard Hunter', 'Volcanic Drift', 'Celestial Guard', 'Zephyr Dancer',
    'Eclipse Prowler', 'Ember Coil', 'Glacial Tempest', 'Stormcaller',
    'Riftwalker', 'Aurora Reaver',
  ],
  legendary: [
    'Chimera', 'Phoenix Reborn', 'Dragonlord', 'Onyx Sovereign',
  ],
};

function placeholderSkinRows() {
  const out = [];
  let n = 1;
  for (const { rarity, count } of PLACEHOLDER_RARITY_SPLIT) {
    const pool = PLACEHOLDER_NAME_POOLS[rarity] ?? [];
    for (let i = 0; i < count; i += 1) {
      const name = pool.length > 0
        ? pool[i % pool.length]
        : `Placeholder ${rarity} ${String(n).padStart(3, '0')}`;
      out.push({
        name,
        rarity,
        imageUrl: `/placeholder/legacy_${String(n).padStart(3, '0')}.png`,
        description: `${name} (no tier render).`,
      });
      n += 1;
    }
  }
  return out;
}

/**
 * Vault stock plan: copies per (image-backed) skin name. With 8 names
 * per rarity, total unbound image-backed stock per rarity is 8 × value.
 *
 * Captain spec (Apr 2026) — minimum total unbound copies per rarity to
 * survive heavy demo pack purchasing across 50 demo accounts:
 *   common ≥ 400, rare ≥ 200, epic ≥ 100, legendary ≥ 40.
 *
 * Per-name values: 50 / 25 / 13 / 15 → totals 400 / 200 / 104 / 120.
 *
 * Legendary bumped from 5 → 15 (Apr 2026): pack.service.js blocks 5 of
 * the 8 legendary names for demo accounts (Kraken, Diamond Hands, Apex
 * Predator, Celestial, Valiant — see DEMO_LEGENDARY_BLOCKLIST), so
 * demos can only consume vault stock for 3 unblocked names (Gilded
 * Throne, Samurai, Necromancer). 15 per name × 3 demo-eligible = 45
 * pullable legendaries against 50 demo accounts — covers everyone with
 * a small buffer.
 */
const VAULT_COPY_PLAN = {
  legendary: 15,
  epic: 13,
  rare: 25,
  common: 50,
};

/** Catalog row + (count - 1) extra vault copies. The catalog row IS the
 *  first vault copy, so a `5 copies each` plan inserts the catalog row
 *  + 4 extras. */
function vaultCopyRows() {
  const out = [];
  for (const t of IMAGE_BACKED_SKINS) {
    const target = VAULT_COPY_PLAN[t.rarity] ?? 1;
    for (let i = 0; i < target - 1; i += 1) {
      out.push({
        name: t.name,
        rarity: t.rarity,
        imageUrl: t.imageUrl,
        description: `${t.name} (vault stock).`,
      });
    }
  }
  return out;
}

async function seedSkinVault() {
  // Idempotency: if catalog rows for every IMAGE_BACKED_SKIN exist
  // (counted by name+rarity), skip. Catalog presence is the witness for
  // "this seed already ran".
  const counts = { catalog: 0, placeholders: 0, vaultCopies: 0 };

  // Catalog rows.
  for (const t of IMAGE_BACKED_SKINS) {
    const [existing] = await db
      .select()
      .from(skins)
      .where(
        and(
          eq(skins.name, t.name),
          eq(skins.rarity, t.rarity),
          isNull(skins.userId),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(skins).values({
      name: t.name,
      rarity: t.rarity,
      imageUrl: t.imageUrl,
      description: `${t.rarity} skin - ${t.name}`,
    });
    counts.catalog += 1;
  }

  // Placeholders. Only insert if the placeholder pool is below the target.
  // Idempotency keyed on imageUrl (durable marker for placeholder rows)
  // rather than name. The one-shot rename script
  // (scripts/rename-legacy-skins-prod.js) flips placeholder names from
  // `Legacy <Rarity> NNN` to themed pool names, so a name-prefix check
  // would think the pool is empty after rename and re-insert 70 dupes.
  // The imageUrl path `/placeholder/legacy_NNN.png` doesn't change.
  const placeholderTarget = PLACEHOLDER_RARITY_SPLIT.reduce(
    (s, r) => s + r.count,
    0,
  );
  const placeholderExisting = await db
    .select()
    .from(skins)
    .where(
      and(isNull(skins.userId), sql`${skins.imageUrl} LIKE '/placeholder/%'`),
    );
  if (placeholderExisting.length < placeholderTarget) {
    const want = placeholderSkinRows().slice(placeholderExisting.length);
    if (want.length > 0) {
      await db.insert(skins).values(want);
      counts.placeholders = want.length;
    }
  }

  // Vault copies. For each (name, rarity), ensure the total count of
  // userId-NULL rows hits VAULT_COPY_PLAN[rarity].
  for (const t of IMAGE_BACKED_SKINS) {
    const target = VAULT_COPY_PLAN[t.rarity] ?? 1;
    const existing = await db
      .select()
      .from(skins)
      .where(
        and(
          eq(skins.name, t.name),
          eq(skins.rarity, t.rarity),
          isNull(skins.userId),
        ),
      );
    const need = target - existing.length;
    if (need <= 0) continue;
    const rows = Array.from({ length: need }, () => ({
      name: t.name,
      rarity: t.rarity,
      imageUrl: t.imageUrl,
      description: `${t.name} (vault stock).`,
    }));
    await db.insert(skins).values(rows);
    counts.vaultCopies += need;
  }

  return counts;
}

/* -------------------------------------------------------------------------- */
/* F. mod vault                                                               */
/* -------------------------------------------------------------------------- */

const MOD_TEMPLATES = [
  // Common (10)
  { name: 'Streamline Plate',  rarity: 'common', bonus: ['speed', 2],            penalty: ['turning', 1] },
  { name: 'Grip Pads',         rarity: 'common', bonus: ['turning', 2],          penalty: ['speed', 1] },
  { name: 'Quick Charge',      rarity: 'common', bonus: ['batteryCapacity', 2], penalty: ['durability', 1] },
  { name: 'Shock Absorber',    rarity: 'common', bonus: ['durability', 2],       penalty: ['acceleration', 1] },
  { name: 'Steady Module',     rarity: 'common', bonus: ['consistency', 2],      penalty: ['speed', 1] },
  { name: 'Night Lens',        rarity: 'common', bonus: ['nightVision', 2],      penalty: ['rainHandling', 1] },
  { name: 'Rain Shield',       rarity: 'common', bonus: ['rainHandling', 2],     penalty: ['windResistance', 1] },
  { name: 'Wind Fin',          rarity: 'common', bonus: ['windResistance', 2],   penalty: ['nightVision', 1] },
  { name: 'Light Frame',       rarity: 'common', bonus: ['acceleration', 2],     penalty: ['durability', 1] },
  { name: 'Tracker Coil',      rarity: 'common', bonus: ['turning', 2],          penalty: ['batteryCapacity', 1] },
  // Rare (8)
  { name: 'Aero Shell',        rarity: 'rare', bonus: ['speed', 4],            penalty: ['turning', 2] },
  { name: 'Grip Coating',      rarity: 'rare', bonus: ['turning', 4],          penalty: ['acceleration', 2] },
  { name: 'Storm Plating',     rarity: 'rare', bonus: ['rainHandling', 4],     penalty: ['speed', 2] },
  { name: 'Night Optics',      rarity: 'rare', bonus: ['nightVision', 4],      penalty: ['batteryCapacity', 2] },
  { name: 'Turbo Intake',      rarity: 'rare', bonus: ['acceleration', 4],     penalty: ['consistency', 2] },
  { name: 'Endurance Core',    rarity: 'rare', bonus: ['batteryCapacity', 4],  penalty: ['speed', 2] },
  { name: 'Aileron Kit',       rarity: 'rare', bonus: ['windResistance', 4],   penalty: ['acceleration', 2] },
  { name: 'Stabilizer Brace',  rarity: 'rare', bonus: ['consistency', 4],      penalty: ['speed', 2] },
  // Epic (5)
  { name: 'Plasma Core',       rarity: 'epic', bonus: ['acceleration', 6],     penalty: ['consistency', 4] },
  { name: 'Stealth Aero',      rarity: 'epic', bonus: ['speed', 6],            penalty: ['durability', 4] },
  { name: 'Typhoon Module',    rarity: 'epic', bonus: ['rainHandling', 8],     penalty: ['speed', 5] },
  { name: 'Predator Lens',     rarity: 'epic', bonus: ['nightVision', 8],      penalty: ['batteryCapacity', 5] },
  { name: 'Iron Hull',         rarity: 'epic', bonus: ['durability', 7],       penalty: ['turning', 4] },
  // Legendary (3)
  { name: 'Phantom Drive', rarity: 'legendary', special: 'Ignores battery degradation on lap 1.',     penalty: ['windResistance', 5] },
  { name: 'Quantum Sync',  rarity: 'legendary', special: 'Consistency stat applies double on turn segments.', penalty: ['speed', 4] },
  { name: 'Storm Rider',   rarity: 'legendary', special: 'All weather penalties reduced by 50%.',     penalty: ['acceleration', 6] },
];

const STAT_LABEL = {
  speed: 'Speed',
  turning: 'Turning',
  acceleration: 'Acceleration',
  durability: 'Durability',
  consistency: 'Consistency',
  batteryCapacity: 'Battery',
  nightVision: 'Night Vision',
  rainHandling: 'Rain',
  windResistance: 'Wind',
};

function modDescription(t) {
  const p = `-${t.penalty[1]}% ${STAT_LABEL[t.penalty[0]] ?? t.penalty[0]}`;
  if (t.rarity === 'legendary') return `${t.special} ${p}.`;
  const b = `+${t.bonus[1]}% ${STAT_LABEL[t.bonus[0]] ?? t.bonus[0]}`;
  return `${b}, ${p}.`;
}

function modTemplateRow(t) {
  return {
    name: t.name,
    rarity: t.rarity,
    description: modDescription(t),
    statBonusType: t.bonus ? t.bonus[0] : null,
    statBonusValue: t.bonus ? String(t.bonus[1]) : null,
    statPenaltyType: t.penalty ? t.penalty[0] : null,
    statPenaltyValue: t.penalty ? String(t.penalty[1]) : null,
    specialAbility: t.special ?? null,
    imageUrl: null,
  };
}

/**
 * Mod vault extras (beyond the templates) per rarity. Templates count
 * toward the rarity total too, so total unbound mods per rarity is
 * `templates(rarity) + extras(rarity)`. Templates: 10 common, 8 rare,
 * 5 epic, 3 legendary.
 *
 * Captain spec (Apr 2026) — same minimum totals as the skin vault:
 *   common ≥ 400, rare ≥ 200, epic ≥ 100, legendary ≥ 40.
 *
 * Extras below give totals: 410 / 208 / 105 / 43.
 */
const MOD_VAULT_EXTRA_PLAN = { common: 400, rare: 200, epic: 100, legendary: 40 };

async function seedModVault() {
  const counts = { templates: 0, vaultCopies: 0 };

  // Templates.
  for (const t of MOD_TEMPLATES) {
    const [existing] = await db
      .select()
      .from(mods)
      .where(
        and(
          eq(mods.name, t.name),
          eq(mods.rarity, t.rarity),
          isNull(mods.userId),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(mods).values(modTemplateRow(t));
    counts.templates += 1;
  }

  // Extra vault copies. Distribute the per-rarity targets evenly across
  // the templates of that rarity. The "templates" row above is the first
  // copy; this loop adds the remaining `targetExtras` rows on top.
  for (const [rarity, target] of Object.entries(MOD_VAULT_EXTRA_PLAN)) {
    const rarityTemplates = MOD_TEMPLATES.filter((t) => t.rarity === rarity);
    if (rarityTemplates.length === 0) continue;

    // Existing total vault rows for this rarity.
    const existingRows = await db
      .select()
      .from(mods)
      .where(and(eq(mods.rarity, rarity), isNull(mods.userId)));
    const haveExtras = existingRows.length - rarityTemplates.length;
    const need = target - Math.max(0, haveExtras);
    if (need <= 0) continue;

    const rows = [];
    for (let i = 0; i < need; i += 1) {
      const t = rarityTemplates[i % rarityTemplates.length];
      rows.push(modTemplateRow(t));
    }
    await db.insert(mods).values(rows);
    counts.vaultCopies += need;
  }

  return counts;
}

/* -------------------------------------------------------------------------- */
/* G. marketplace listings                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Allocate one vault skin (userId NULL) of a given name to a seller and
 * list it. Skips silently if no vault stock remains. Returns the listing
 * row or null.
 */
async function listSkinFromVault(sellerId, name, price) {
  const [available] = await db
    .select()
    .from(skins)
    .where(and(eq(skins.name, name), isNull(skins.userId)))
    .limit(1);
  if (!available) return null;

  // Skip if this seller already has an active listing for this skin id.
  const [dup] = await db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        eq(marketplaceListings.sellerId, sellerId),
        eq(marketplaceListings.skinId, available.id),
        eq(marketplaceListings.status, 'active'),
      ),
    )
    .limit(1);
  if (dup) return null;

  await db.update(skins).set({ userId: sellerId }).where(eq(skins.id, available.id));
  const [listing] = await db
    .insert(marketplaceListings)
    .values({
      sellerId,
      itemType: 'skin',
      skinId: available.id,
      price,
      status: 'active',
    })
    .returning();
  return listing;
}

async function listOnePlaceholderSkin(sellerId, rarity, price) {
  const all = await db
    .select()
    .from(skins)
    .where(and(eq(skins.rarity, rarity), isNull(skins.userId)));
  const available = all.find(
    (s) => !(s.imageUrl?.startsWith('/skins/') && s.imageUrl?.endsWith('.webp')),
  );
  if (!available) return null;
  await db.update(skins).set({ userId: sellerId }).where(eq(skins.id, available.id));
  const [listing] = await db
    .insert(marketplaceListings)
    .values({
      sellerId,
      itemType: 'skin',
      skinId: available.id,
      price,
      status: 'active',
    })
    .returning();
  return listing;
}

async function listOneModFromVault(sellerId, rarity, price) {
  const [available] = await db
    .select()
    .from(mods)
    .where(and(eq(mods.rarity, rarity), isNull(mods.userId)))
    .limit(1);
  if (!available) return null;
  await db.update(mods).set({ userId: sellerId }).where(eq(mods.id, available.id));
  const [listing] = await db
    .insert(marketplaceListings)
    .values({
      sellerId,
      itemType: 'mod',
      modId: available.id,
      price,
      status: 'active',
    })
    .returning();
  return listing;
}

/* Drone listings: fresh-mint a drone owned by the seller and list it.
 * Idempotency is keyed on the (sellerId, drone name) pair. */
async function mintAndListDrone(sellerId, level, profile, price) {
  const droneName = await generateUniqueDroneName(db, drones);
  const { stats, tsb } = buildStats(level, profile);
  const [drone] = await db
    .insert(drones)
    .values({
      userId: sellerId,
      name: droneName,
      level,
      xp: 0,
      xpToNextLevel: 300 * level * level,
      totalStatBudget: tsb,
      ...stats,
      active: false,
      isBot: false,
      eloRating: 1000,
      imageUrl: '/drones/default.png',
    })
    .returning();
  const [listing] = await db
    .insert(marketplaceListings)
    .values({
      sellerId,
      itemType: 'drone',
      droneId: drone.id,
      price,
      status: 'active',
    })
    .returning();
  return { drone, listing };
}

async function bindModToDrone(sellerId, droneId, rarity) {
  const [available] = await db
    .select()
    .from(mods)
    .where(and(eq(mods.rarity, rarity), isNull(mods.userId)))
    .limit(1);
  if (!available) return false;
  await db.update(mods).set({ userId: sellerId }).where(eq(mods.id, available.id));
  await db.insert(schema.droneMods).values({
    droneId,
    modId: available.id,
    isEquipped: true,
  });
  await db.update(drones).set({ appliedModId: available.id }).where(eq(drones.id, droneId));
  return true;
}

/* -------------------------------------------------------------------------- */
/* G2. Drone listings with skins bound (mixed rarities)                       */
/* -------------------------------------------------------------------------- */

/* Hand-picked drone listings that ship with a bound + equipped skin so
 * the marketplace board has visible cosmetic listings.
 *
 * One legendary anchor (Valiant) + two epic-skinned tier-4 drones using
 * skins that have applied tier-4 renders in lib/utils.js#APPLIED_RENDERS
 * (Dragon Scale, Crystal Phantom). The skin transfers with the drone on
 * sale (per marketplace.service.buyListing).
 *
 * Drone names are random `MARKET_<lvl>_<6char>` like the rest of the
 * mint+list path so these listings don't visually stand out from the
 * regular drone listings — the skin alone is the differentiator.
 *
 * Idempotency: count active drone listings owned by MKT_* sellers whose
 * drone has an appliedSkinId. If we already have >= the target count,
 * skip the whole section. */
/**
 * Per-listing price ranges baked in: Valiant LV19 (T4 base + legendary
 * value), Dragon Scale LV17 (T4 base + epic premium), Crystal Phantom
 * LV12 (T3 base + epic premium). Each run rolls a price uniformly inside
 * its range so two seed runs don't list identical prices on the
 * showcase. Mirror these in scripts/fix-marketplace-featured.js.
 */
const DRONE_LISTINGS_WITH_SKINS = [
  { level: 19, profile: 'speedster',  priceRange: [550_000, 650_000], skinName: 'Valiant',         skinRarity: 'legendary' },
  { level: 17, profile: 'cornerer',   priceRange: [400_000, 500_000], skinName: 'Dragon Scale',    skinRarity: 'epic'      },
  { level: 12, profile: 'allrounder', priceRange: [180_000, 220_000], skinName: 'Crystal Phantom', skinRarity: 'epic'      },
];

async function seedDroneListingsWithSkins(botUserMap) {
  const counts = { inserted: 0, skipped: 0, missingSkin: 0 };
  const sellerIds = ['MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT']
    .map((u) => botUserMap[u]?.id)
    .filter(Boolean);
  if (sellerIds.length === 0) return counts;

  // Idempotency anchor: drone names are random per run so we can't key on
  // name. Instead count MKT_-owned active drone listings whose drone has
  // ANY applied skin. If we already have at least the target count, the
  // section is considered seeded.
  const existingSkinned = await db
    .select({ id: marketplaceListings.id })
    .from(marketplaceListings)
    .innerJoin(drones, eq(drones.id, marketplaceListings.droneId))
    .where(
      and(
        eq(marketplaceListings.status, 'active'),
        inArray(marketplaceListings.sellerId, sellerIds),
        sql`${drones.appliedSkinId} IS NOT NULL`,
      ),
    );
  if (existingSkinned.length >= DRONE_LISTINGS_WITH_SKINS.length) {
    counts.skipped = existingSkinned.length;
    return counts;
  }

  for (let idx = 0; idx < DRONE_LISTINGS_WITH_SKINS.length; idx += 1) {
    const def = DRONE_LISTINGS_WITH_SKINS[idx];
    const sellerId = sellerIds[idx % sellerIds.length];

    const droneName = await generateUniqueDroneName(db, drones);

    const { stats, tsb } = buildStats(def.level, def.profile);
    const [drone] = await db
      .insert(drones)
      .values({
        userId: sellerId,
        name: droneName,
        level: def.level,
        xp: 0,
        xpToNextLevel: 300 * def.level * def.level,
        totalStatBudget: tsb,
        ...stats,
        active: false,
        isBot: false,
        eloRating: 1000,
        imageUrl: '/drones/default.png',
      })
      .returning();

    // Pull a vault copy of the legendary skin, transfer to the seller,
    // bind to the drone, mark equipped. If no vault stock remains, log
    // it but still ship the drone listing (without the bound skin).
    const [vaultSkin] = await db
      .select()
      .from(skins)
      .where(and(eq(skins.name, def.skinName), isNull(skins.userId)))
      .limit(1);

    if (vaultSkin) {
      await db
        .update(skins)
        .set({ userId: sellerId })
        .where(eq(skins.id, vaultSkin.id));
      await db.insert(schema.droneSkins).values({
        droneId: drone.id,
        skinId: vaultSkin.id,
        isEquipped: true,
      });
      await db
        .update(drones)
        .set({ appliedSkinId: vaultSkin.id })
        .where(eq(drones.id, drone.id));
    } else {
      counts.missingSkin += 1;
    }

    const price = randInt(def.priceRange[0], def.priceRange[1]);
    await db.insert(marketplaceListings).values({
      sellerId,
      itemType: 'drone',
      droneId: drone.id,
      price,
      status: 'active',
    });
    counts.inserted += 1;
  }
  return counts;
}

async function seedMarketplaceListings(botUserMap) {
  const counts = { skins: 0, mods: 0, drones: 0 };
  // Idempotency anchor: if MKT_PULSE already has 10+ active listings,
  // assume this seed has run. Skip the whole section.
  const pulse = botUserMap.MKT_PULSE;
  if (!pulse) return counts;
  const existing = await db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        eq(marketplaceListings.sellerId, pulse.id),
        eq(marketplaceListings.status, 'active'),
      ),
    );
  if (existing.length >= 10) return counts;

  const sellers = ['MKT_PULSE', 'MKT_NEXUS', 'MKT_ORBIT'].map(
    (name) => botUserMap[name].id,
  );
  const seller = (i) => sellers[i % sellers.length];

  /* --- Skin listings (~40) --- */
  let i = 0;
  if (await listSkinFromVault(seller(i++), 'Celestial', 135_000)) counts.skins += 1;
  if (await listSkinFromVault(seller(i++), 'Valiant',   142_000)) counts.skins += 1;

  const epicListNames = ['Crystal Phantom', 'Dragon Scale', 'Frozen Abyss', 'Obsidian Core'];
  for (const n of epicListNames) {
    if (await listSkinFromVault(seller(i++), n, randInt(18_000, 25_000))) counts.skins += 1;
  }
  const rareListNames = ['Anodized Blaze', 'Arctic Fury', 'Chrome Fury', 'Copper King'];
  for (const n of rareListNames) {
    if (await listSkinFromVault(seller(i++), n, randInt(4_000, 8_000))) counts.skins += 1;
  }
  const commonListNames = ['Bone', 'Cobalt', 'Frost', 'Ember'];
  for (const n of commonListNames) {
    if (await listSkinFromVault(seller(i++), n, randInt(800, 1_500))) counts.skins += 1;
  }

  // 25 placeholder listings split by rarity (rough rarity pyramid).
  const placeholderListPlan = [
    ['common', 12, [200, 600]],
    ['rare', 8, [1_500, 3_500]],
    ['epic', 4, [10_000, 18_000]],
    ['legendary', 1, [85_000, 110_000]],
  ];
  for (const [rarity, count, [low, high]] of placeholderListPlan) {
    for (let k = 0; k < count; k += 1) {
      if (await listOnePlaceholderSkin(seller(i++), rarity, randInt(low, high))) {
        counts.skins += 1;
      }
    }
  }

  /* --- Mod listings (~30) --- */
  if (await listOneModFromVault(seller(i++), 'legendary', 65_000)) counts.mods += 1;
  for (let k = 0; k < 3; k += 1) {
    if (await listOneModFromVault(seller(i++), 'epic', randInt(8_000, 15_000))) counts.mods += 1;
  }
  for (let k = 0; k < 8; k += 1) {
    if (await listOneModFromVault(seller(i++), 'rare', randInt(1_500, 4_000))) counts.mods += 1;
  }
  for (let k = 0; k < 18; k += 1) {
    if (await listOneModFromVault(seller(i++), 'common', randInt(200, 700))) counts.mods += 1;
  }

  /* --- Drone listings (~30) --- Counts mirror the bracket distribution
       (T4 small, T1/T2 long tail). Prices come from priceForLevel(level)
       so the per-tier band lives in one place (PRICE_TIERS at the top of
       this file). */
  const droneListPlan = [
    { count: 4,  level: () => randInt(16, 20) },
    { count: 6,  level: () => randInt(11, 15) },
    { count: 10, level: () => randInt(6, 10) },
    { count: 10, level: () => randInt(1, 5) },
  ];
  const profiles = Object.keys(BOT_PROFILES);
  let droneIdx = 0;
  for (const plan of droneListPlan) {
    for (let k = 0; k < plan.count; k += 1) {
      const profile = profiles[droneIdx % profiles.length];
      const lvl = plan.level();
      const { drone } = await mintAndListDrone(
        seller(i++),
        lvl,
        profile,
        priceForLevel(lvl),
      );
      counts.drones += 1;
      // 1 in 6 drones gets a bound mod, marketplace listing price already
      // baked in the higher end for those tiers.
      if (droneIdx % 6 === 0) {
        await bindModToDrone(drone.userId, drone.id, 'rare');
      }
      droneIdx += 1;
    }
  }

  return counts;
}

/* -------------------------------------------------------------------------- */
/* H. demo accounts                                                           */
/* -------------------------------------------------------------------------- */

async function seedDemoAccounts() {
  const counts = {
    users: 0,
    accountsSeeded: 0,
    drones: 0,
    skins: 0,
    mods: 0,
    races: 0,
    skipped: 0,
  };

  // Captain Apr 2026: bumped from 10 to 50. Pre-seeded pool covers
  // PILOT_D01..PILOT_D50; rotation arrays in seed-demo-player.js (3 and
  // 5 entries) wrap cleanly via demoIndex modulus.
  for (let i = 0; i < 50; i += 1) {
    const num = String(i + 1).padStart(2, '0');
    const username = `PILOT_D${num}`;
    const email = `pilot_d${num}@demo.hyperdrome.gg`;

    // Look up by username OR email. After a demo claim, the email is
    // rewritten to claimed_*@demo.hyperdrome.gg but the username stays
    // PILOT_D##; an email-only lookup would miss the row and the
    // subsequent INSERT would conflict on the unique username
    // constraint. The username path catches claimed accounts; the email
    // path catches the original unclaimed state.
    //
    // Idempotency: if the row exists at all, skip — drone presence is
    // not the witness. A claimed account with manually-deleted drones
    // would otherwise get re-seeded onto the claimed user.
    const [existing] = await db
      .select()
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1);

    if (existing) {
      counts.skipped += 1;
      continue;
    }

    const [created] = await db
      .insert(users)
      .values({
        name: username,
        username,
        email,
        emailVerified: new Date(),
      })
      .returning();
    const userRow = created;
    counts.users += 1;

    const result = await seedDemoAccount({
      db,
      userId: userRow.id,
      demoIndex: i,
    });
    counts.accountsSeeded += 1;
    counts.drones += result.drones;
    counts.skins += result.skins;
    counts.mods += result.mods;
    counts.races += result.races;
  }

  return counts;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function fmt(label, payload) {
  console.log(`  ${label.padEnd(22)} ${JSON.stringify(payload)}`);
}

/**
 * Run the full seed pipeline. Exposed so the dev wrapper
 * (scripts/seed-dev.js) can call it after truncating the local DB.
 *
 * @param {{ skipConfirm?: boolean, fresh?: boolean }} [opts]
 *   `skipConfirm: true` bypasses the interactive YES gate. Used by the
 *   dev wrapper since the operator already opted in via the seed:dev
 *   command and the local-only env flag.
 *   `fresh: true` truncates the player/inventory/race tables before
 *   seeding. Tracks, seasons, and admin_config are preserved.
 */
export async function runSeed({ skipConfirm = false, fresh = false } = {}) {
  if (!skipConfirm) await confirmProd();
  const t0 = Date.now();
  if (fresh) await truncateForFresh();
  console.log('\nSeeding production database...\n');

  const adminCount = await seedAdminConfig();
  fmt('A. admin_config', { rows: adminCount, conflicts_ignored: true });

  const tracksResult = await seedTracks();
  fmt('D. tracks', tracksResult);

  const seasonInserted = await seedSeasonOne();
  fmt('   season_1', { inserted: seasonInserted });

  const botUsersInserted = await seedBotUsers();
  fmt('B. bot_users', { inserted: botUsersInserted, total: BOT_USERS.length });

  const botUserMap = await getBotUserMap();

  const racingBotsInserted = await seedRacingBots(botUserMap);
  fmt('C. racing_bots', { inserted: racingBotsInserted, total: RACING_BOTS.length });

  const skinVault = await seedSkinVault();
  fmt('E. skin_vault', skinVault);

  const modVault = await seedModVault();
  fmt('F. mod_vault', modVault);

  const marketplace = await seedMarketplaceListings(botUserMap);
  fmt('G. marketplace', marketplace);

  const skinnedDrones = await seedDroneListingsWithSkins(botUserMap);
  fmt('G2. skinned_drones', skinnedDrones);

  console.log('\n  Seeding 50 demo accounts (real race simulation)...');
  const demo = await seedDemoAccounts();
  fmt('H. demo_accounts', demo);

  const dt = Math.round((Date.now() - t0) / 100) / 10;
  console.log(`\nDone in ${dt}s.`);
}

// Auto-run only when invoked directly (`node scripts/seed-production.js`),
// not when imported by the dev wrapper. fileURLToPath converts the ESM
// module URL to an absolute path that matches Node's resolution of
// process.argv[1].
const { fileURLToPath } = await import('node:url');
const path = await import('node:path');
const isDirectInvocation =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  const fresh = process.argv.includes('--fresh');
  runSeed({ fresh }).catch((err) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
  });
}
