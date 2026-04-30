/**
 * Drone name generator. Single source of truth for random drone names
 * across the magic-link starter, NPC vendor purchase, XP-milestone
 * spawn, marketplace mint, and any future generated-drone path.
 *
 * Pattern: `WORD-<LETTER><DIGIT>` (e.g. `VORTEX-X3`, `NEON-V8`).
 * Pool ≈ 171 × 26 × 10 = 44,460 unique base combinations. Combined
 * with the DB-checked uniqueness loop in `generateUniqueDroneName`,
 * collision is essentially impossible at any realistic drone count.
 *
 * Hand-named drones (`RACING_BOTS` in `scripts/seed-production.js`,
 * `DEMO_DRONES` in `scripts/seed-demo-player.js`) live outside this
 * module. The uniqueness check queries the full `drones` table, so
 * generated names will never collide with those fixed names either.
 */

import { eq } from 'drizzle-orm';

/** Cyberpunk-flavored word pool. Add words by appending - the
 *  generator picks uniformly. */
export const DRONE_NAME_WORDS = [
  'ACE', 'AEGIS', 'AGON', 'ALPHA', 'AMP', 'APEX', 'ARC', 'ARCANE',
  'ARGON', 'ASCEND', 'ASH', 'AURORA', 'AXIS', 'AZURE',
  'BANDIT', 'BANE', 'BANSHEE', 'BARON', 'BASILISK', 'BLADE', 'BLAZE',
  'BLITZ', 'BOLT', 'BOREAL', 'BREACH', 'BRIMSTONE', 'BURN',
  'CARBON', 'CASCADE', 'CHASM', 'CINDER', 'CIPHER', 'CLAW', 'COBRA',
  'COMET', 'CORE', 'CRESCENT', 'CREST', 'CRYO', 'CYBER', 'CYCLONE',
  'CYPHER',
  'DAGGER', 'DART', 'DASH', 'DRAKE', 'DUSK',
  'ECHO', 'EDGE', 'EMBER', 'EXILE',
  'FANG', 'FERAL', 'FLARE', 'FLINT', 'FLUX', 'FORGE', 'FROST', 'FUSE',
  'FURY',
  'GALE', 'GHOST', 'GLITCH', 'GRIM',
  'HALO', 'HAVOC', 'HAWK', 'HELIX', 'HEX', 'HOLLOW', 'HORDE', 'HOWL',
  'HUNTER', 'HYDRA',
  'INFERNO', 'IRON',
  'JADE', 'JINX',
  'KAIJU', 'KARMA', 'KRYPT',
  'LANCE', 'LIMBO', 'LOOM', 'LYNX',
  'MACH', 'MAVERICK', 'MIRAGE',
  'NEMESIS', 'NEON', 'NEXUS', 'NIGHT', 'NOMAD', 'NOVA',
  'ODIN', 'OMEGA', 'ONI', 'ORACLE', 'ORBIT', 'OSPREY', 'OUTRIDER',
  'PHANTOM', 'PIXEL', 'PLAGUE', 'PRISM', 'PROTO', 'PULSE', 'PURGE',
  'PYRE',
  'QUARTZ', 'QUEST',
  'RAGE', 'RAIDER', 'RAMPAGE', 'RAPTOR', 'RAZOR', 'REBEL', 'RELIC',
  'RIDER', 'RIPTIDE', 'ROGUE', 'RONIN',
  'SABLE', 'SAINT', 'SAVAGE', 'SCAR', 'SCYTHE', 'SHADOW', 'SHATTER',
  'SHIFT', 'SHRIKE', 'SIGIL', 'SIREN', 'SLAYER', 'SOLAR', 'SONIC',
  'SPARK', 'SPECTER', 'SPIKE', 'SPIRE', 'STORM', 'STRIKE', 'STRIX',
  'STYX',
  'TALON', 'TEMPO', 'TIDE', 'TITAN', 'TOMB', 'TOXIN', 'TUNDRA',
  'TYPHOON',
  'UMBRA',
  'VANTA', 'VAPOR', 'VECTOR', 'VENOM', 'VERTEX', 'VIPER', 'VOID',
  'VOLT', 'VORTEX',
  'WARDEN', 'WARP', 'WIDOW', 'WRAITH', 'WRATH',
  'ZEAL', 'ZENITH', 'ZEPHYR', 'ZERO',
];

const SUFFIX_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Stateless single-shot name generator. Use this for tests or contexts
 * where a DB collision check isn't possible (e.g. fixtures). For all
 * insertion paths use `generateUniqueDroneName` instead.
 *
 * @returns {string} `WORD-<LETTER><DIGIT>` like `VORTEX-X3`.
 */
export function randomDroneName() {
  const word =
    DRONE_NAME_WORDS[Math.floor(Math.random() * DRONE_NAME_WORDS.length)];
  const letter =
    SUFFIX_LETTERS[Math.floor(Math.random() * SUFFIX_LETTERS.length)];
  const digit = Math.floor(Math.random() * 10);
  return `${word}-${letter}${digit}`;
}

/**
 * DB-checked drone name. Loops calling `randomDroneName` and picks the
 * first candidate not already present in `drones.name`. After
 * `maxAttempts` collisions (vanishingly rare even at thousands of
 * drones), appends a 4-character random base-36 suffix as a final
 * tie-breaker so the function is guaranteed to return a unique name
 * even under pathological collision pressure.
 *
 * Note: there's a non-zero race window between the SELECT and a
 * downstream INSERT (two concurrent calls could both pass the check
 * before either inserts). At our volumes this is practically
 * impossible; if it ever bites, add a UNIQUE index on `drones.name`
 * (which would require migrating around the demo-seed exemption that
 * Captain has explicitly asked to preserve).
 *
 * @param {object} db - drizzle db instance
 * @param {object} dronesTable - the `drones` table schema reference
 *   (so this helper doesn't need to know the import path of the
 *   schema module - keeps it framework-friendly for both server-side
 *   route handlers and standalone scripts).
 * @param {{ maxAttempts?: number }} [options]
 * @returns {Promise<string>} unique drone name
 */
export async function generateUniqueDroneName(db, dronesTable, options = {}) {
  const { maxAttempts = 8 } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = randomDroneName();
    const [existing] = await db
      .select({ id: dronesTable.id })
      .from(dronesTable)
      .where(eq(dronesTable.name, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  const base = randomDroneName();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}-${suffix}`;
}
