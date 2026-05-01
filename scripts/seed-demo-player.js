/**
 * Demo-account seeding helper used by both:
 *   - scripts/seed-production.js (creates PILOT_D01..D10 in advance)
 *   - app/api/auth/demo/route.js (fresh-create fallback when all 10 are claimed)
 *
 * Both paths produce visually identical accounts: 8 drones, equipped
 * legendaries cloned per user, real `simulateRace`-driven race history.
 *
 * Plain JS, no Next.js imports - the engine functions
 * (`simulateRace`, `calculateNewElo`, `calculateRacePoints`) are pure and
 * the schema is loaded by relative path so the file works under both
 * `node --env-file=.env.local` and inside the Next.js runtime.
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../lib/db/schema.js';
import { canEquipSkin } from '../lib/utils.js';
import {
  simulateRace,
  randomWeather,
  randomTimeOfDay,
} from '../lib/game-engine/race-simulator.js';
import {
  calculateNewElo,
  calculateRacePoints,
} from '../lib/game-engine/economy.js';
import { generateUniqueDroneName } from '../lib/game-engine/drone-names.js';
import { buildStats } from '../lib/game-engine/drone-stats.js';

const {
  users,
  drones,
  skins,
  mods,
  droneSkins,
  droneMods,
  tracks,
  races,
  droneOwnershipHistory,
} = schema;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STARTING_VOLTS = 110_000;
const ACTIVE_DRONE_SLOTS = 3;
const RACES_PER_DRONE = 10;
const XP_PER_WIN = 10;
const XP_PER_LOSS = 4;

/**
 * 8-drone roster every demo account gets. Levels span all 4 tiers so the
 * dashboard, leaderboard, and race history have data at every bracket.
 * Active = first 3 (3 of 8) - matches activeDroneSlots cap.
 *
 * `archetype` is an internal slot label only - it drives the per-slot skin
 * policy below (Diamond Hands on the LV18, Ember on the LV3, rotated
 * tier-4 epic on the LV17, plus the SCOUT / BOLT collection inserts) and
 * never reaches the user. The DB-visible drone name is generated per row
 * via `generateUniqueDroneName`, so two demo accounts never share a drone
 * name in race results.
 */
const DEMO_DRONES = [
  { archetype: 'STRIKER', level: 18, active: true,  profile: 'speedster',   equippedSkinPolicy: 'diamond' },
  { archetype: 'RUNNER',  level: 3,  active: true,  profile: 'balanced',    equippedSkinPolicy: 'ember' },
  { archetype: 'VIPER',   level: 17, active: true,  profile: 'cornerer',    equippedSkinPolicy: 'tier4_rotation' },
  { archetype: 'SCOUT',   level: 12, active: false, profile: 'allrounder' },
  { archetype: 'BOLT',    level: 7,  active: false, profile: 'speedster' },
  { archetype: 'HAWK',    level: 16, active: false, profile: 'nightHunter' },
  { archetype: 'PHANTOM', level: 5,  active: false, profile: 'balanced' },
  { archetype: 'GHOST',   level: 14, active: false, profile: 'tank' },
];

/** demoIndex % 5 -> which tier-4 epic equips on VIPER. */
const VIPER_SKIN_ROTATION = [
  'Chrome Fury',
  'Crystal Phantom',
  'Dragon Scale',
  'Obsidian Core',
  'Frozen Abyss',
];

/** demoIndex % 3 -> which legendary skin sits unbound in the player's vault. */
const UNBOUND_LEGENDARY_ROTATION = ['Apex Predator', 'Kraken', 'Celestial'];

/** demoIndex % 3 -> which legendary mod sits unbound in the player's vault. */
const LEGENDARY_MOD_ROTATION = ['Phantom Drive', 'Quantum Sync', 'Storm Rider'];

/* -------------------------------------------------------------------------- */
/* RNG / utility                                                              */
/* -------------------------------------------------------------------------- */

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* -------------------------------------------------------------------------- */
/* Template lookups (operate on userId-NULL vault rows only)                  */
/* -------------------------------------------------------------------------- */

async function findVaultSkinByName(db, name) {
  const [row] = await db
    .select()
    .from(skins)
    .where(and(eq(skins.name, name), isNull(skins.userId)))
    .limit(1);
  return row ?? null;
}

async function findVaultModByName(db, name) {
  const [row] = await db
    .select()
    .from(mods)
    .where(and(eq(mods.name, name), isNull(mods.userId)))
    .limit(1);
  return row ?? null;
}

/** Pick `n` distinct image-backed skin templates of the given rarity from
 *  the vault, optionally excluding ids already used by this account. */
async function pickVaultSkinTemplatesByRarity(db, rarity, n, excludeIds = new Set()) {
  const all = await db
    .select()
    .from(skins)
    .where(and(eq(skins.rarity, rarity), isNull(skins.userId)));
  const imageBacked = all.filter(
    (s) =>
      s.imageUrl?.startsWith('/skins/') &&
      s.imageUrl?.endsWith('.webp') &&
      !excludeIds.has(s.id),
  );
  const seenNames = new Set();
  const distinct = [];
  const shuffled = [...imageBacked].sort(() => Math.random() - 0.5);
  for (const s of shuffled) {
    if (seenNames.has(s.name)) continue;
    seenNames.add(s.name);
    distinct.push(s);
    if (distinct.length >= n) break;
  }
  return distinct;
}

/** Pick `n` placeholder skins (vault rows whose imageUrl isn't a real
 *  /skins/...webp). These are the "no tier render — Not available in
 *  demo on equip" entries Captain wants in every demo inventory. */
async function pickPlaceholderSkinTemplates(db, n) {
  const all = await db
    .select()
    .from(skins)
    .where(isNull(skins.userId));
  const placeholders = all.filter(
    (s) =>
      !(s.imageUrl?.startsWith('/skins/') && s.imageUrl?.endsWith('.webp')),
  );
  const shuffled = [...placeholders].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

async function pickVaultModsByRarity(db, rarity, n) {
  const all = await db
    .select()
    .from(mods)
    .where(and(eq(mods.rarity, rarity), isNull(mods.userId)));
  const seenNames = new Set();
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  const distinct = [];
  for (const m of shuffled) {
    if (seenNames.has(m.name)) continue;
    seenNames.add(m.name);
    distinct.push(m);
    if (distinct.length >= n) break;
  }
  return distinct;
}

/* -------------------------------------------------------------------------- */
/* Cloning - copy a vault template into a userId-owned row                    */
/* -------------------------------------------------------------------------- */

async function cloneSkin(db, userId, template) {
  if (!template) return null;
  const [row] = await db
    .insert(skins)
    .values({
      userId,
      name: template.name,
      rarity: template.rarity,
      imageUrl: template.imageUrl,
      description: template.description,
    })
    .returning();
  return row;
}

async function cloneMod(db, userId, template) {
  if (!template) return null;
  const [row] = await db
    .insert(mods)
    .values({
      userId,
      name: template.name,
      rarity: template.rarity,
      description: template.description,
      statBonusType: template.statBonusType,
      statBonusValue: template.statBonusValue,
      statPenaltyType: template.statPenaltyType,
      statPenaltyValue: template.statPenaltyValue,
      specialAbility: template.specialAbility,
      imageUrl: template.imageUrl,
    })
    .returning();
  return row;
}

/* -------------------------------------------------------------------------- */
/* Real-race history                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Run RACES_PER_DRONE real `simulateRace` matches against bracket-eligible
 * bots and persist them with batched DB writes. Captain spec: race
 * history must be indistinguishable from live gameplay — same engine,
 * same ELO formula, same point payout.
 *
 * Batching strategy (cuts ~50% of round trips on the 800-race demo seed):
 *   - All race rows for this drone are accumulated locally and bulk-
 *     inserted in a single statement.
 *   - Bot side-effects (ELO drift + win/loss counters) are accumulated
 *     in a Map keyed by bot id and flushed as one UPDATE per unique bot
 *     touched, rather than one per race. Bot ELO still mutates in-memory
 *     between iterations so subsequent races within the loop see the
 *     up-to-date rating — only the DB write is deferred.
 */
async function runRealRaces(db, demoDrone, allBots, allTracks) {
  const eligibleTracks = allTracks.filter(
    (t) => demoDrone.level >= t.levelMin && demoDrone.level <= t.levelMax,
  );
  const eligibleBots = allBots.filter(
    (b) => Math.abs(b.level - demoDrone.level) <= 3,
  );
  if (eligibleTracks.length === 0 || eligibleBots.length === 0) {
    return { wins: 0, losses: 0, points: 0, finalElo: demoDrone.eloRating };
  }

  // Mutable local view of the demo drone's evolving ELO. The DB row is
  // written once at the end; intermediate races fold into this counter.
  let droneElo = demoDrone.eloRating;
  let wins = 0;
  let losses = 0;
  let points = 0;

  const raceRows = [];
  /** botId -> { eloRating, racesInc, winsInc, lossesInc } */
  const botDeltas = new Map();

  for (let i = 0; i < RACES_PER_DRONE; i += 1) {
    const track = pick(eligibleTracks);
    const bot = pick(eligibleBots);
    const weather = randomWeather();
    const timeOfDay = randomTimeOfDay();

    // Randomise drone1/drone2 slot so the demo doesn't always sit in the
    // same column on the race detail page.
    const demoFirst = Math.random() < 0.5;
    const demoView = { ...demoDrone, eloRating: droneElo };
    const drone1 = demoFirst ? demoView : bot;
    const drone2 = demoFirst ? bot : demoView;

    const result = simulateRace(drone1, drone2, track, weather, timeOfDay);
    const demoWon = result.winnerId === demoDrone.id;

    const winnerEloBefore = demoWon ? droneElo : bot.eloRating;
    const loserEloBefore = demoWon ? bot.eloRating : droneElo;
    const { newWinnerElo, newLoserElo } = calculateNewElo(
      winnerEloBefore,
      loserEloBefore,
    );
    const pointsAwarded = calculateRacePoints(
      track.difficulty,
      winnerEloBefore,
      loserEloBefore,
    );

    const drone1EloBefore = demoFirst ? droneElo : bot.eloRating;
    const drone2EloBefore = demoFirst ? bot.eloRating : droneElo;
    const drone1EloAfter =
      result.winnerId === drone1.id ? newWinnerElo : newLoserElo;
    const drone2EloAfter =
      result.winnerId === drone2.id ? newWinnerElo : newLoserElo;

    // Spread races across the past ~30 days so the dashboard timeline
    // doesn't show 80 races stacked at 'just now'.
    const ageMs = Math.random() * 30 * 24 * 60 * 60 * 1000;
    const createdAt = new Date(Date.now() - ageMs);

    raceRows.push({
      status: 'completed',
      createdAt,
      scheduledAt: createdAt,
      drone1Id: drone1.id,
      drone2Id: drone2.id,
      trackId: track.id,
      winnerDroneId: result.winnerId,
      pointsAwarded,
      xpWinner: XP_PER_WIN,
      xpLoser: XP_PER_LOSS,
      timeOfDay,
      weather,
      drone1Time: String(result.drone1Time),
      drone2Time: String(result.drone2Time),
      drone1EloBefore,
      drone2EloBefore,
      drone1EloChange: drone1EloAfter - drone1EloBefore,
      drone2EloChange: drone2EloAfter - drone2EloBefore,
      raceLog: result.raceLog,
    });

    // Bot side-effects: keep the in-memory ELO mutated so subsequent
    // iterations using the same bot reference see the new rating, but
    // defer the DB write into a per-bot aggregate flushed after the loop.
    const botNewElo = demoWon ? newLoserElo : newWinnerElo;
    bot.eloRating = botNewElo;
    const prev = botDeltas.get(bot.id) ?? {
      eloRating: botNewElo,
      racesInc: 0,
      winsInc: 0,
      lossesInc: 0,
    };
    prev.eloRating = botNewElo; // last write wins
    prev.racesInc += 1;
    if (demoWon) prev.lossesInc += 1;
    else prev.winsInc += 1;
    botDeltas.set(bot.id, prev);

    droneElo = demoWon ? newWinnerElo : newLoserElo;
    if (demoWon) {
      wins += 1;
      points += pointsAwarded;
    } else {
      losses += 1;
    }
  }

  // Flush: 1 bulk INSERT for all race rows + 1 UPDATE per unique bot.
  if (raceRows.length > 0) {
    await db.insert(races).values(raceRows);
  }
  for (const [botId, delta] of botDeltas) {
    await db
      .update(drones)
      .set({
        eloRating: delta.eloRating,
        totalRaces: sql`${drones.totalRaces} + ${delta.racesInc}`,
        wins: sql`${drones.wins} + ${delta.winsInc}`,
        losses: sql`${drones.losses} + ${delta.lossesInc}`,
      })
      .where(eq(drones.id, botId));
  }

  return { wins, losses, points, finalElo: droneElo };
}

/* -------------------------------------------------------------------------- */
/* Equip helpers                                                              */
/* -------------------------------------------------------------------------- */

async function equipClonedSkin(db, drone, skinRow) {
  await db.insert(droneSkins).values({
    droneId: drone.id,
    skinId: skinRow.id,
    isEquipped: true,
  });
  await db
    .update(drones)
    .set({ appliedSkinId: skinRow.id })
    .where(eq(drones.id, drone.id));
}

/* -------------------------------------------------------------------------- */
/* Main per-account function                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fully provision one demo account. Idempotency caller's responsibility:
 * skip if the user already has drones. Inputs:
 *   - db: a Drizzle client (caller controls which DB)
 *   - userId: id of the just-created PILOT_* row
 *   - demoIndex: 0..9, drives the rotation of VIPER skin / unbound
 *     legendary / legendary mod so consecutive demo accounts don't all
 *     look identical.
 *
 * Returns row counts for the orchestrator's report.
 *
 * @param {{ db: object, userId: string, demoIndex: number }} args
 */
export async function seedDemoAccount({ db, userId, demoIndex }) {
  const counts = { drones: 0, skins: 0, mods: 0, races: 0 };
  const usedSkinIds = new Set();

  // 1. Volts + slots.
  await db
    .update(users)
    .set({ points: STARTING_VOLTS, activeDroneSlots: ACTIVE_DRONE_SLOTS })
    .where(eq(users.id, userId));

  // 2. 8 drones. Names generated per-row via generateUniqueDroneName so
  // each demo account's drones never collide with another account's. The
  // generator queries the DB on each attempt, so the loop is sequential
  // (not .map + Promise.all) - parallel calls would all see the same
  // pre-insert state and could pick the same candidate. After insert we
  // map the inserted rows back to their archetype label by index, since
  // .returning() preserves input order; downstream skin/mod equip steps
  // use that map to find each archetype's drone (STRIKER, RUNNER, etc.).
  const droneRows = [];
  for (const d of DEMO_DRONES) {
    const { stats, tsb } = buildStats(d.level, d.profile);
    const name = await generateUniqueDroneName(db, drones);
    droneRows.push({
      userId,
      name,
      level: d.level,
      xp: 0,
      xpToNextLevel: 300 * d.level * d.level,
      totalStatBudget: tsb,
      ...stats,
      active: d.active,
      eloRating: 1000,
      imageUrl: '/drones/default.png',
      isBot: false,
    });
  }
  const insertedDrones = await db.insert(drones).values(droneRows).returning();
  const droneByArchetype = Object.fromEntries(
    insertedDrones.map((d, i) => [DEMO_DRONES[i].archetype, d]),
  );
  counts.drones = insertedDrones.length;

  // 3. Ownership audit rows.
  await db.insert(droneOwnershipHistory).values(
    insertedDrones.map((d) => ({
      droneId: d.id,
      ownerUserId: userId,
      transactionType: 'creation',
    })),
  );

  // 4a. STRIKER -> Diamond Hands (legendary, always equippable).
  const dhTemplate = await findVaultSkinByName(db, 'Diamond Hands');
  const dhClone = await cloneSkin(db, userId, dhTemplate);
  if (dhClone) {
    counts.skins += 1;
    usedSkinIds.add(dhClone.id);
    await equipClonedSkin(db, droneByArchetype.STRIKER, dhClone);
  }

  // 4b. RUNNER -> Ember (common with tier-1 render).
  const emberTemplate = await findVaultSkinByName(db, 'Ember');
  const emberClone = await cloneSkin(db, userId, emberTemplate);
  if (emberClone) {
    counts.skins += 1;
    usedSkinIds.add(emberClone.id);
    if (canEquipSkin(emberClone, droneByArchetype.RUNNER.level)) {
      await equipClonedSkin(db, droneByArchetype.RUNNER, emberClone);
    } else {
      // Render not registered -> still bind so the player owns the cosmetic.
      await db.insert(droneSkins).values({
        droneId: droneByArchetype.RUNNER.id,
        skinId: emberClone.id,
        isEquipped: false,
      });
    }
  }

  // 4c. VIPER -> rotated tier-4 epic.
  const viperSkinName =
    VIPER_SKIN_ROTATION[demoIndex % VIPER_SKIN_ROTATION.length];
  const viperTemplate = await findVaultSkinByName(db, viperSkinName);
  const viperClone = await cloneSkin(db, userId, viperTemplate);
  if (viperClone) {
    counts.skins += 1;
    usedSkinIds.add(viperClone.id);
    if (canEquipSkin(viperClone, droneByArchetype.VIPER.level)) {
      await equipClonedSkin(db, droneByArchetype.VIPER, viperClone);
    } else {
      await db.insert(droneSkins).values({
        droneId: droneByArchetype.VIPER.id,
        skinId: viperClone.id,
        isEquipped: false,
      });
    }
  }

  // 5. Unbound legendary skin (rotated).
  const unboundLegendaryName =
    UNBOUND_LEGENDARY_ROTATION[demoIndex % UNBOUND_LEGENDARY_ROTATION.length];
  const unboundLegendaryTemplate = await findVaultSkinByName(
    db,
    unboundLegendaryName,
  );
  const unboundLegendaryClone = await cloneSkin(
    db,
    userId,
    unboundLegendaryTemplate,
  );
  if (unboundLegendaryClone) {
    counts.skins += 1;
    usedSkinIds.add(unboundLegendaryClone.id);
  }

  // 6. Unbound legendary mod (rotated).
  const legendaryModName =
    LEGENDARY_MOD_ROTATION[demoIndex % LEGENDARY_MOD_ROTATION.length];
  const legendaryModTemplate = await findVaultModByName(db, legendaryModName);
  if (await cloneMod(db, userId, legendaryModTemplate)) counts.mods += 1;

  // 7. 2-3 unbound placeholder skins.
  const placeholders = await pickPlaceholderSkinTemplates(db, randInt(2, 3));
  for (const t of placeholders) {
    const cloned = await cloneSkin(db, userId, t);
    if (cloned) {
      counts.skins += 1;
      usedSkinIds.add(cloned.id);
    }
  }

  // 8. 2-3 unbound mods (common/rare mix).
  const unboundCommonMods = await pickVaultModsByRarity(db, 'common', randInt(1, 2));
  const unboundRareMods = await pickVaultModsByRarity(db, 'rare', 1);
  for (const t of [...unboundCommonMods, ...unboundRareMods]) {
    if (await cloneMod(db, userId, t)) counts.mods += 1;
  }

  // 9. SCOUT collection: 1 bound-but-not-equipped skin (different from used).
  const scoutTemplates = await pickVaultSkinTemplatesByRarity(
    db,
    'rare',
    1,
    usedSkinIds,
  );
  if (scoutTemplates.length > 0) {
    const cloned = await cloneSkin(db, userId, scoutTemplates[0]);
    if (cloned) {
      counts.skins += 1;
      usedSkinIds.add(cloned.id);
      await db.insert(droneSkins).values({
        droneId: droneByArchetype.SCOUT.id,
        skinId: cloned.id,
        isEquipped: false,
      });
    }
  }

  // 10. BOLT collection: 1 bound-but-not-equipped mod.
  const boltMods = await pickVaultModsByRarity(db, 'common', 1);
  if (boltMods.length > 0) {
    const cloned = await cloneMod(db, userId, boltMods[0]);
    if (cloned) {
      counts.mods += 1;
      await db.insert(droneMods).values({
        droneId: droneByArchetype.BOLT.id,
        modId: cloned.id,
        isEquipped: false,
      });
    }
  }

  // 11. Real race history.
  const allBots = await db
    .select()
    .from(drones)
    .where(eq(drones.isBot, true));
  const allTracks = await db.select().from(tracks);
  if (allBots.length === 0 || allTracks.length === 0) {
    return counts;
  }

  let userTotalRaces = 0;
  let userTotalWins = 0;

  for (const def of DEMO_DRONES) {
    const drone = droneByArchetype[def.archetype];
    const result = await runRealRaces(db, drone, allBots, allTracks);

    await db
      .update(drones)
      .set({
        wins: result.wins,
        losses: result.losses,
        totalRaces: result.wins + result.losses,
        eloRating: result.finalElo,
      })
      .where(eq(drones.id, drone.id));

    userTotalRaces += result.wins + result.losses;
    userTotalWins += result.wins;
    counts.races += result.wins + result.losses;
  }

  // 12. Roll up onto the user row. Balance stays at STARTING_VOLTS —
  // simulated race winnings are NOT added to the demo balance, so every
  // demo player sees exactly 110,000V on first login regardless of how
  // many races their roster won during seeding.
  await db
    .update(users)
    .set({
      totalRaces: userTotalRaces,
      totalWins: userTotalWins,
      eloRating:
        1000 +
        Math.round((userTotalWins - (userTotalRaces - userTotalWins)) / 2),
    })
    .where(eq(users.id, userId));

  return counts;
}

/* -------------------------------------------------------------------------- */
/* Demo-route fallback wrapper                                                */
/* -------------------------------------------------------------------------- */

/**
 * Used by /api/auth/demo when all 50 pre-seeded accounts are claimed.
 * Builds its own Drizzle client off DATABASE_URL (the live app DB) and
 * picks a random `demoIndex` so the fresh account looks like one of the
 * 50 archetypes.
 *
 * @param {string} userId
 */
export async function seedDemoPlayer(userId) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const localDb = drizzle(neon(url), { schema });
  return seedDemoAccount({
    db: localDb,
    userId,
    demoIndex: Math.floor(Math.random() * 50),
  });
}
