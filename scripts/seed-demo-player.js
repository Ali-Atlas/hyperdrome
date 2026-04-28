import { and, eq, ne } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { canEquipSkin } from '@/lib/utils.js';

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

/**
 * Drone roster handed to a fresh demo pilot. Levels are spread across all
 * 4 tiers so the demo shows the full progression UI; ELO targets seed the
 * race history with a believable win/loss distribution.
 */
const DEMO_DRONES = [
  { name: 'STRIKER', level: 18, active: true,  targetElo: 1150, equippedSkin: 'Kraken',       skinFallbackRarity: 'legendary' },
  { name: 'PHANTOM', level: 12, active: true,  targetElo: 1050, equippedSkin: 'Diamond Hand', skinFallbackRarity: 'legendary' },
  { name: 'VIPER',   level: 17, active: false, targetElo: 1080, equippedSkin: 'Frozen Abyss', skinFallbackRarity: 'epic' },
  { name: 'SPARK',   level: 8,  active: true,  targetElo: 980,  equippedSkin: null },
  { name: 'GHOST',   level: 15, active: false, targetElo: 1020, equippedSkin: null },
  { name: 'BOLT',    level: 6,  active: false, targetElo: 1000, equippedSkin: null },
  { name: 'ROOKIE',  level: 3,  active: false, targetElo: 950,  equippedSkin: null },
];

const STAT_KEYS_RANDOMIZED = ['speed', 'turning', 'acceleration', 'durability'];

/**
 * Unbound inventory skins. Each entry pairs a preferred name with a
 * rarity fallback so the demo still ends up with something pullable
 * even when the named template hasn't been seeded into this DB yet.
 */
const UNBOUND_SKINS = [
  { name: 'Apex Predator', fallbackRarity: 'legendary' },
  { name: 'Ember', fallbackRarity: 'common' },
  { name: 'Chrome Fury', fallbackRarity: 'rare' },
];

const TSB_BASE = 9;
const TSB_PER_LEVEL = 20;
const STAT_CAP_BASE = 10;
const STAT_CAP_PER_LEVEL = 4.5;

const WEATHERS = ['clear', 'clouds', 'rain', 'heavy_rain', 'wind', 'haze', 'fog'];
const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'];

const MAX_RACES_PER_DRONE = 80;
const MIN_RACES_PER_DRONE = 30;
const RACE_INSERT_CHUNK = 50;
const RACE_HISTORY_DAYS = 45;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function tsbForLevel(level) {
  return TSB_BASE + TSB_PER_LEVEL * level;
}

function statCapForLevel(level) {
  return Math.min(100, STAT_CAP_BASE + Math.floor(STAT_CAP_PER_LEVEL * level));
}

/**
 * Build a stat block for a demo drone. Randomizes 4 of the 9 stats inside
 * [5, statCap]; every other stat stays at 1. If the rolled total exceeds
 * the level's TSB, decrement randomly chosen above-floor stats until it
 * fits. Mirrors the bot-stat builder in `lib/db/seed.js` but biased toward
 * the 4 "headline" stats players see first.
 */
function buildDemoStats(level) {
  const cap = statCapForLevel(level);
  const tsb = tsbForLevel(level);
  const stats = {
    speed: 1, turning: 1, acceleration: 1, durability: 1,
    nightVision: 1, batteryCapacity: 1, rainHandling: 1,
    windResistance: 1, consistency: 1,
  };
  for (const key of STAT_KEYS_RANDOMIZED) {
    stats[key] = randInt(5, cap);
  }
  let total = Object.values(stats).reduce((a, b) => a + b, 0);
  let guard = 0;
  while (total > tsb && guard < 1000) {
    const reducible = STAT_KEYS_RANDOMIZED.filter((k) => stats[k] > 5);
    if (reducible.length === 0) break;
    const k = pick(reducible);
    stats[k] -= 1;
    total -= 1;
    guard += 1;
  }
  return { stats, tsb };
}

/**
 * Map a target ELO to a target win rate. Bots default to 1000 ELO, so
 * higher demo ELO = higher fraction of historical wins. Clamped to a
 * sensible band so the lowest-rated demo drone still has SOME wins to
 * surface in the recent-races feed.
 */
function targetWinRate(targetElo) {
  const raw = (targetElo - 850) / 400;
  return Math.max(0.3, Math.min(0.85, raw));
}

/**
 * Find a skin row by name to use as a clone template. Falls back to any
 * row of the same rarity if the named template isn't seeded. Returns null
 * if nothing matches (caller should skip that bind).
 */
async function findSkinTemplate(name, fallbackRarity) {
  const [byName] = await db
    .select()
    .from(skins)
    .where(eq(skins.name, name))
    .limit(1);
  if (byName) return byName;
  if (!fallbackRarity) return null;
  const [byRarity] = await db
    .select()
    .from(skins)
    .where(eq(skins.rarity, fallbackRarity))
    .limit(1);
  return byRarity ?? null;
}

/**
 * Insert a brand-new skin row owned by `userId`, copying the cosmetic
 * fields off `template` so the demo player gets their own private item
 * (cannot collide with another player's vault row).
 */
async function cloneSkin(userId, template) {
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

/**
 * Insert a brand-new mod row owned by `userId`, copying every field that
 * defines the mod's behavior (so the demo player has a real, bindable
 * mod rather than a reference to the shared catalog row).
 */
async function cloneMod(userId, template) {
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

/**
 * Pick `n` distinct mod templates of the given rarity. Distinct by name so
 * the demo doesn't end up with two clones of the same mod when one is
 * enough.
 */
async function pickDistinctModTemplates(rarity, n) {
  const all = await db
    .select()
    .from(mods)
    .where(eq(mods.rarity, rarity));
  const byName = new Map();
  for (const m of all) {
    if (!byName.has(m.name)) byName.set(m.name, m);
  }
  const unique = Array.from(byName.values());
  const out = [];
  const used = new Set();
  while (out.length < n && unique.length > 0) {
    const idx = Math.floor(Math.random() * unique.length);
    if (used.has(idx)) {
      if (used.size >= unique.length) break;
      continue;
    }
    used.add(idx);
    out.push(unique[idx]);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Race history generator                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Build N completed-race rows for one demo drone, distributed across the
 * past `RACE_HISTORY_DAYS` and biased to roughly hit the drone's target
 * ELO via the rolled win rate. Returns the rows plus aggregate counts the
 * caller folds into the drone's wins/losses/totalRaces.
 */
function generateRaceRows({ demoDrone, bots, allTracks, count }) {
  const winRate = targetWinRate(demoDrone.targetElo);
  const rows = [];
  let wins = 0;
  let losses = 0;

  for (let i = 0; i < count; i += 1) {
    const eligibleTracks = allTracks.filter(
      (t) => demoDrone.level >= t.levelMin && demoDrone.level <= t.levelMax,
    );
    const track = pick(eligibleTracks.length > 0 ? eligibleTracks : allTracks);

    const eligibleBots = bots.filter(
      (b) => Math.abs(b.level - demoDrone.level) <= 3,
    );
    const bot = pick(eligibleBots.length > 0 ? eligibleBots : bots);
    if (!bot) continue;

    const demoWon = Math.random() < winRate;
    if (demoWon) wins += 1;
    else losses += 1;

    const demoFirst = Math.random() < 0.5;
    const drone1Id = demoFirst ? demoDrone.id : bot.id;
    const drone2Id = demoFirst ? bot.id : demoDrone.id;
    const winnerDroneId = demoWon ? demoDrone.id : bot.id;

    const winnerTime = 28 + Math.random() * 12;
    const loserTime = winnerTime + 0.5 + Math.random() * 4;
    const drone1Won = drone1Id === winnerDroneId;
    const drone1Time = drone1Won ? winnerTime : loserTime;
    const drone2Time = drone1Won ? loserTime : winnerTime;

    const eloSwing = 14 + Math.floor(Math.random() * 5);
    const drone1IsDemo = drone1Id === demoDrone.id;
    const demoEloChange = demoWon ? eloSwing : -eloSwing;
    const botEloChange = -demoEloChange;

    const ageMs =
      Math.random() * RACE_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    const createdAt = new Date(Date.now() - ageMs);

    rows.push({
      status: 'completed',
      scheduledAt: createdAt,
      createdAt,
      drone1Id,
      drone2Id,
      trackId: track.id,
      winnerDroneId,
      pointsAwarded: demoWon ? 3 : 0,
      xpWinner: 10,
      xpLoser: 4,
      timeOfDay: pick(TIMES_OF_DAY),
      weather: pick(WEATHERS),
      drone1Time: drone1Time.toFixed(4),
      drone2Time: drone2Time.toFixed(4),
      drone1EloBefore: drone1IsDemo ? demoDrone.targetElo : (bot.eloRating ?? 1000),
      drone2EloBefore: drone1IsDemo ? (bot.eloRating ?? 1000) : demoDrone.targetElo,
      drone1EloChange: drone1IsDemo ? demoEloChange : botEloChange,
      drone2EloChange: drone1IsDemo ? botEloChange : demoEloChange,
    });
  }
  return { rows, wins, losses };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Provision a fresh PILOT_* user with a pre-progressed account: 7 drones
 * across all tiers, equipped legendary + epic skins (cloned to private
 * rows so they can't collide with other players), an unbound inventory,
 * mods on a few drones, and a back-history of 30-80 completed races per
 * drone so the dashboard / leaderboard / drone pages all have data to
 * render.
 *
 * Best-effort: writes are sequenced so partial failures still leave a
 * usable account (Neon HTTP has no transactions). The route handler logs
 * any error and signs the user in regardless.
 *
 * @param {string} userId - id of the just-created PILOT_* user row
 */
export async function seedDemoPlayer(userId) {
  // 1. Set the volts balance.
  await db
    .update(users)
    .set({ points: 110_000, activeDroneSlots: 3 })
    .where(eq(users.id, userId));

  // 2. Create the 7 drones.
  const droneRows = DEMO_DRONES.map((d) => {
    const { stats, tsb } = buildDemoStats(d.level);
    return {
      userId,
      name: d.name,
      level: d.level,
      xp: 0,
      xpToNextLevel: 300 * d.level * d.level,
      totalStatBudget: tsb,
      ...stats,
      active: d.active,
      eloRating: d.targetElo,
      imageUrl: '/drones/default.png',
      isBot: false,
    };
  });
  const insertedDrones = await db.insert(drones).values(droneRows).returning();
  const droneByName = Object.fromEntries(insertedDrones.map((d) => [d.name, d]));

  // Audit: each new drone gets a creation row in ownership history.
  await db.insert(droneOwnershipHistory).values(
    insertedDrones.map((d) => ({
      droneId: d.id,
      ownerUserId: userId,
      transactionType: 'creation',
    })),
  );

  // 3. Equip skins on STRIKER / PHANTOM / VIPER. Each is a fresh clone of
  //    the named template so demos never share inventory rows.
  for (const def of DEMO_DRONES) {
    if (!def.equippedSkin) continue;
    const drone = droneByName[def.name];
    if (!drone) continue;

    let template = await findSkinTemplate(
      def.equippedSkin,
      def.skinFallbackRarity,
    );
    let cloned = await cloneSkin(userId, template);
    if (!cloned) continue;

    // Frozen Abyss has a tier-4 webp on disk but isn't yet registered in
    // APPLIED_RENDERS, so canEquipSkin would refuse. Fall back to a
    // template that IS renderable on the drone's tier (Captain-approved
    // substitution for the demo).
    if (!canEquipSkin(cloned, drone.level)) {
      const fallback = await findSkinTemplate('Chrome Fury', 'rare');
      const reclone = await cloneSkin(userId, fallback);
      if (reclone && canEquipSkin(reclone, drone.level)) {
        // Release the unrenderable clone so it doesn't sit in the
        // demo's inventory looking broken.
        await db.delete(skins).where(eq(skins.id, cloned.id));
        cloned = reclone;
      } else {
        // Nothing to equip - leave the original clone in inventory so
        // the demo at least owns the cosmetic, just unequipped.
        await db.insert(droneSkins).values({
          droneId: drone.id,
          skinId: cloned.id,
          isEquipped: false,
        });
        continue;
      }
    }

    await db.insert(droneSkins).values({
      droneId: drone.id,
      skinId: cloned.id,
      isEquipped: true,
    });
    await db
      .update(drones)
      .set({ appliedSkinId: cloned.id })
      .where(eq(drones.id, drone.id));
  }

  // 4. Unbound skins (player binds them later from inventory).
  for (const { name, fallbackRarity } of UNBOUND_SKINS) {
    const template = await findSkinTemplate(name, fallbackRarity);
    if (template) await cloneSkin(userId, template);
  }

  // 5. Bound-but-not-equipped collection skins: 2 commons + 1 rare,
  //    each on a random non-VIPER demo drone (VIPER already has its
  //    equipped slot filled).
  const commonTemplate1 = await pickRandomTemplateByRarity('common');
  const commonTemplate2 = await pickRandomTemplateByRarity('common', commonTemplate1?.id);
  const rareTemplate = await pickRandomTemplateByRarity('rare');
  const collectionDronePool = insertedDrones.filter((d) => d.name !== 'VIPER');
  for (const template of [commonTemplate1, commonTemplate2, rareTemplate]) {
    if (!template) continue;
    const cloned = await cloneSkin(userId, template);
    if (!cloned) continue;
    const drone = pick(collectionDronePool);
    await db.insert(droneSkins).values({
      droneId: drone.id,
      skinId: cloned.id,
      isEquipped: false,
    });
  }

  // 6. Mods.
  const equippedCommonMods = await pickDistinctModTemplates('common', 2);
  const equippedRareMods = await pickDistinctModTemplates('rare', 1);
  const unboundCommonMods = await pickDistinctModTemplates('common', 2);

  const modEquipPlan = [
    { drone: droneByName.STRIKER, template: equippedCommonMods[0] },
    { drone: droneByName.PHANTOM, template: equippedCommonMods[1] },
    { drone: droneByName.SPARK, template: equippedRareMods[0] },
  ];
  for (const { drone, template } of modEquipPlan) {
    if (!drone || !template) continue;
    const cloned = await cloneMod(userId, template);
    if (!cloned) continue;
    await db.insert(droneMods).values({
      droneId: drone.id,
      modId: cloned.id,
      isEquipped: true,
    });
    await db
      .update(drones)
      .set({ appliedModId: cloned.id })
      .where(eq(drones.id, drone.id));
  }
  for (const template of unboundCommonMods) {
    if (!template) continue;
    await cloneMod(userId, template);
  }

  // 7. Race history. Pull bots + tracks once, then generate per-drone.
  const bots = await db
    .select()
    .from(drones)
    .where(eq(drones.isBot, true));
  const allTracks = await db.select().from(tracks);

  if (bots.length === 0 || allTracks.length === 0) {
    // Without bots or tracks we can't seed history. The demo still
    // works but the recent-races feed will be empty. Captain's seed
    // step is expected to have populated both already.
    return;
  }

  let userTotalRaces = 0;
  let userTotalWins = 0;

  for (const def of DEMO_DRONES) {
    const drone = droneByName[def.name];
    if (!drone) continue;
    const count = randInt(MIN_RACES_PER_DRONE, MAX_RACES_PER_DRONE);
    const { rows, wins, losses } = generateRaceRows({
      demoDrone: { ...drone, targetElo: def.targetElo },
      bots,
      allTracks,
      count,
    });

    for (let i = 0; i < rows.length; i += RACE_INSERT_CHUNK) {
      await db.insert(races).values(rows.slice(i, i + RACE_INSERT_CHUNK));
    }

    await db
      .update(drones)
      .set({
        wins,
        losses,
        totalRaces: rows.length,
      })
      .where(eq(drones.id, drone.id));

    userTotalRaces += rows.length;
    userTotalWins += wins;
  }

  // 8. Roll drone-level aggregates up onto the user row so dashboard +
  //    profile cards read consistent numbers.
  await db
    .update(users)
    .set({
      totalRaces: userTotalRaces,
      totalWins: userTotalWins,
      eloRating: 1000 + Math.round((userTotalWins - (userTotalRaces - userTotalWins)) / 2),
    })
    .where(eq(users.id, userId));
}

/**
 * Pick one image-backed skin template of the given rarity. Optional
 * `excludeId` lets the caller avoid cloning the same template twice in
 * a row (used when picking two distinct commons for the collection).
 */
async function pickRandomTemplateByRarity(rarity, excludeId) {
  const conditions = [eq(skins.rarity, rarity)];
  if (excludeId) conditions.push(ne(skins.id, excludeId));
  const all = await db
    .select()
    .from(skins)
    .where(and(...conditions));
  if (all.length === 0) return null;
  return pick(all);
}
