import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from './schema.js';

const { tracks, adminConfig, seasons, drones, skins } = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Run via: npm run seed');
  process.exit(1);
}

const db = drizzle(neon(connectionString), { schema });

/* -------------------------------------------------------------------------- */
/* Data                                                                       */
/* -------------------------------------------------------------------------- */

// Tracks carry an inclusive level bracket (levelMin..levelMax). Matchmaking
// only picks tracks whose bracket overlaps a drone's level, so a level-7
// drone never races on a level-11+ track (and vice versa). Difficulty is a
// 1-10 absolute rating independent of the bracket.
const TRACK_DATA = [
  { name: 'Neon Straightaway', straights: 8, turns: 2, length: 'short',  difficulty: 2, levelMin: 1,  levelMax: 5,  imageUrl: '/tracks/neon_straightaway.png' },
  { name: 'The Grid',          straights: 6, turns: 4, length: 'short',  difficulty: 3, levelMin: 1,  levelMax: 10, imageUrl: '/tracks/the_grid.png' },
  { name: 'Circuit Alpha',     straights: 5, turns: 5, length: 'medium', difficulty: 4, levelMin: 1,  levelMax: 10, imageUrl: '/tracks/circuit_alpha.png' },
  { name: 'Skyline Drift',     straights: 3, turns: 7, length: 'medium', difficulty: 5, levelMin: 6,  levelMax: 15, imageUrl: '/tracks/skyline_drift.png' },
  { name: 'Voltage Loop',      straights: 4, turns: 8, length: 'long',   difficulty: 7, levelMin: 6,  levelMax: 20, imageUrl: '/tracks/voltage_loop.png' },
  { name: 'Tempest Run',       straights: 2, turns: 8, length: 'long',   difficulty: 9, levelMin: 11, levelMax: 20, imageUrl: '/tracks/tempest_run.png' },
  { name: 'Horizon Express',   straights: 9, turns: 1, length: 'medium', difficulty: 1, levelMin: 1,  levelMax: 10, imageUrl: '/tracks/horizon_express.png' },
];

const ADMIN_CONFIG = [
  ['race_interval_seconds',    '300',   'Seconds between race cycles'],
  ['points_per_win_base',      '3',     'Base points awarded to race winner'],
  ['xp_per_win',               '10',    'XP awarded to race winner'],
  ['xp_per_loss',              '4',     'XP awarded to race loser'],
  ['tsb_base',                 '9',     'Base TSB (sum of starting stats)'],
  ['tsb_per_level',            '20',    'Additional TSB granted per level'],
  ['stat_cap_base',            '10',    'Base per-stat cap'],
  ['stat_cap_per_level',       '4.5',   'Additional per-stat cap per level'],
  ['xp_curve_multiplier',      '300',   'XP to next level = multiplier * level^2'],
  ['marketplace_fee_percent',  '5',     'Platform fee on marketplace transactions'],
  ['season_duration_days',     '30',    'Default season length in days'],
  ['bot_density_minimum',      '4',     'Minimum bots per bracket to ensure matchmaking'],
  ['skin_drop_rate_common',    '0.05',  'Chance of common skin drop per race'],
  ['skin_drop_rate_rare',      '0.02',  'Chance of rare skin drop per race'],
  ['skin_drop_rate_epic',      '0.005', 'Chance of epic skin drop per race'],
  ['skin_drop_rate_legendary', '0.001', 'Chance of legendary skin drop per race'],
  ['slot_2_unlock_races',      '500',   'Total races to unlock active slot 2'],
  ['slot_3_unlock_races',      '2000',  'Total races to unlock active slot 3'],
  ['racing_enabled',           'false', 'Master switch to enable/disable automatic racing'],
];

const BOT_PROFILES = {
  balanced:     [1, 1, 1, 1, 1, 1, 1, 1, 1],
  speedster:    [3, 1, 3, 1, 1, 1, 1, 3, 1],
  cornerer:     [1, 4, 1, 2, 1, 1, 1, 1, 2],
  tank:         [1, 1, 1, 4, 1, 2, 1, 1, 2],
  nightHunter:  [2, 1, 1, 1, 4, 1, 1, 1, 1],
  rainRider:    [1, 2, 1, 1, 1, 1, 4, 1, 2],
  windWalker:   [2, 1, 2, 1, 1, 1, 1, 4, 1],
  marathoner:   [2, 1, 1, 2, 1, 4, 1, 1, 1],
  consistencer: [1, 2, 1, 1, 1, 1, 1, 1, 5],
  allrounder:   [2, 2, 2, 2, 1, 1, 1, 1, 2],
};

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

const BOT_DEFS = [
  // Level bracket 1–5 (10 bots)
  { name: 'PHANTOM-X1', level: 1,  profile: 'balanced' },
  { name: 'SHADOW-R3',  level: 2,  profile: 'speedster' },
  { name: 'VIPER-K7',   level: 2,  profile: 'cornerer' },
  { name: 'ECHO-M4',    level: 3,  profile: 'balanced' },
  { name: 'PULSE-D9',   level: 3,  profile: 'tank' },
  { name: 'NOVA-B2',    level: 4,  profile: 'nightHunter' },
  { name: 'STORM-F6',   level: 4,  profile: 'rainRider' },
  { name: 'GHOST-L8',   level: 5,  profile: 'speedster' },
  { name: 'VOLT-S5',    level: 5,  profile: 'consistencer' },
  { name: 'CYBER-T1',   level: 5,  profile: 'allrounder' },
  // Level bracket 6–10 (10 bots)
  { name: 'HAWK-W4',    level: 6,  profile: 'speedster' },
  { name: 'BLADE-Z7',   level: 6,  profile: 'cornerer' },
  { name: 'FANG-H3',    level: 7,  profile: 'tank' },
  { name: 'DART-C9',    level: 7,  profile: 'windWalker' },
  { name: 'BOLT-P5',    level: 8,  profile: 'marathoner' },
  { name: 'RAGE-Q2',    level: 8,  profile: 'balanced' },
  { name: 'FURY-N6',    level: 9,  profile: 'nightHunter' },
  { name: 'APEX-V8',    level: 9,  profile: 'consistencer' },
  { name: 'ZERO-G0',    level: 10, profile: 'allrounder' },
  { name: 'OMEGA-X9',   level: 10, profile: 'speedster' },
];

const SKIN_NAMES = {
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
  ],
  epic: [
    'Inferno Phoenix', 'Tidal Surge', 'Thunder Strike', 'Void Walker',
    'Blizzard Hunter', 'Volcanic Drift', 'Celestial Guard', 'Zephyr Dancer',
  ],
  legendary: [
    'Chimera', 'Phoenix Reborn', 'Dragonlord',
  ],
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a level-appropriate stat block for a bot drone.
 * Distributes (TSB - 9) points across the 9 stats using a weighted profile,
 * clamped by the per-stat cap at the given level.
 * @param {number} level
 * @param {string} profileName
 * @returns {{ stats: Record<string, number>, tsb: number }}
 */
function buildBotStats(level, profileName) {
  const tsb = 9 + 20 * level;
  const cap = Math.min(100, 10 + Math.floor(4.5 * level));
  const points = tsb - 9;
  const weights = BOT_PROFILES[profileName];
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

async function tableIsEmpty(table) {
  const rows = await db.select().from(table).limit(1);
  return rows.length === 0;
}

/* -------------------------------------------------------------------------- */
/* Seed steps                                                                 */
/* -------------------------------------------------------------------------- */

async function seedTracks() {
  if (!(await tableIsEmpty(tracks))) {
    console.log('  tracks       skipped (already seeded)');
    return;
  }
  await db.insert(tracks).values(TRACK_DATA);
  console.log(`  tracks       inserted (${TRACK_DATA.length})`);
}

async function seedAdminConfig() {
  const rows = ADMIN_CONFIG.map(([key, value, description]) => ({
    key,
    value,
    description,
  }));
  await db.insert(adminConfig).values(rows).onConflictDoNothing();
  console.log(`  admin_config inserted (${rows.length}, conflicts ignored)`);
}

async function seedSeasons() {
  const existing = await db
    .select()
    .from(seasons)
    .where(eq(seasons.seasonNumber, 1))
    .limit(1);
  if (existing.length > 0) {
    console.log('  seasons      skipped (Season 1 already exists)');
    return;
  }
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(seasons).values({
    seasonNumber: 1,
    startDate: now,
    endDate: end,
    isActive: true,
  });
  console.log('  seasons      inserted (Season 1, 30 days)');
}

async function seedBots() {
  const existing = await db
    .select()
    .from(drones)
    .where(eq(drones.isBot, true))
    .limit(1);
  if (existing.length > 0) {
    console.log('  bot drones   skipped (bots already seeded)');
    return;
  }

  const rows = BOT_DEFS.map(({ name, level, profile }) => {
    const { stats, tsb } = buildBotStats(level, profile);
    return {
      name,
      level,
      xp: 0,
      xpToNextLevel: 300 * level * level,
      totalStatBudget: tsb,
      unspentPoints: 0,
      ...stats,
      active: true,
      isBot: true,
      imageUrl: '/drones/default.png',
    };
  });

  await db.insert(drones).values(rows);
  console.log(`  bot drones   inserted (${rows.length})`);
}

async function seedSkins() {
  if (!(await tableIsEmpty(skins))) {
    console.log('  skins        skipped (already seeded)');
    return;
  }

  const rows = [];
  for (const [rarity, names] of Object.entries(SKIN_NAMES)) {
    names.forEach((name, i) => {
      rows.push({
        name,
        rarity,
        imageUrl: `/skins/${rarity}_${String(i + 1).padStart(2, '0')}.png`,
        description: `${rarity} skin - ${name}`,
      });
    });
  }

  await db.insert(skins).values(rows);
  console.log(
    `  skins        inserted (${rows.length}: 30 common, 15 rare, 8 epic, 3 legendary)`,
  );
}

/* -------------------------------------------------------------------------- */
/* Entrypoint                                                                 */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log('Seeding Drone Manager database...');
  await seedTracks();
  await seedAdminConfig();
  await seedSeasons();
  await seedBots();
  await seedSkins();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
