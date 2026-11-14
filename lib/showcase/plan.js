/**
 * The showcase seed's plan (SPEC.md 6, Showcase seed), pure data and arithmetic: the kit minted to
 * the operator's account, the four pilot accounts with what each lists and at what price, and the
 * ordered steps `services/showcase-seed.service.js` sends. Template ids are SPEC.md 4.2 ids; every
 * skin is a catalog skin with art (2.6), never a placeholder.
 */
import { calculatePerStatCap, calculateTSB } from '../game-engine/economy.js';
import { skinTemplate } from '../game-engine/skin-templates.js';
import { STAT_KEYS, modTemplate } from '../game-engine/templates.js';
import { uuidV5 } from '../teams/action-id.js';
import { allocateAlongPersona } from '../teams/allocation.js';
import { RARITY_BASE_PRICE } from '../teams/policy.js';

/** @typedef {import('../game-engine/templates.js').StatKey} StatKey */
/** @typedef {'common' | 'rare' | 'epic' | 'legendary'} Rarity */

/**
 * @typedef {object} DroneSpec
 * @property {string} name
 * @property {number} level
 * @property {keyof typeof BUILDS} build stat weights the drone is minted along, at TSB(level)
 * @property {number[]} skins skin templates bound to it, in bind order (the first that the 2.6
 *   tier rule allows is equipped)
 * @property {number[]} mods mod templates bound to it, in bind order (the first is equipped)
 * @typedef {{ kind: 'skin' | 'mod', template: number, price: number }} ItemListing
 * @typedef {object} Kit
 * @property {DroneSpec[]} drones
 * @property {number[]} skins unbound skin templates
 * @property {number[]} mods unbound mod templates
 * @property {number} volts Volts minted once
 * @property {string[]} active drone names in the order they are set active, as far as the
 *   account's active slots (2.2) go
 * @property {Record<string, number>} prices piece key (see `kitSteps`) to its listing price
 * @typedef {object} PilotDef
 * @property {string} username also the users row's name; the account slug comes from it (12)
 * @property {DroneSpec} drone the one drone the pilot lists
 * @property {DroneSpec} racer the drone the pilot keeps, unlisted, and races
 * @property {ItemListing[]} listings the unbound items the pilot lists
 * @typedef {object} Step
 * @property {string} key unique within a kit; the action id is derived from it
 * @property {'mint_drone' | 'mint_item' | 'mint_volts' | 'bind' | 'list'} method
 * @property {string} label what the step is, for the printed plan and the run log
 * @property {Record<string, unknown>} [args] mint args without `owner` or `to`
 * @property {string} [piece] bind and list: the key of the minted piece it acts on
 * @property {string} [drone] bind: the key of the drone it binds to
 * @property {number} [price] list: Volts
 */

/** Stat weights, percent, in SPEC.md 2.1 order; each sums to 100. */
export const BUILDS = Object.freeze({
  speed: weights(30, 10, 20, 6, 4, 8, 4, 12, 6),
  turning: weights(8, 30, 14, 22, 4, 8, 4, 4, 6),
  weather: weights(12, 12, 8, 6, 22, 6, 22, 6, 6),
  endurance: weights(12, 12, 8, 8, 4, 24, 4, 4, 24),
  balanced: weights(12, 11, 11, 11, 11, 11, 11, 11, 11),
});

/**
 * @param {...number} values nine weights in stat order
 * @returns {Readonly<Record<StatKey, number>>}
 */
function weights(...values) {
  return Object.freeze(
    /** @type {Record<StatKey, number>} */ (
      Object.fromEntries(STAT_KEYS.map((key, i) => [key, values[i]]))
    )
  );
}

/** A listed drone's price: the vendor drone (2.1), plus this per level above 1, plus its kit. */
export const DRONE_BASE_PRICE = 3_500;
export const DRONE_PRICE_PER_LEVEL = 500;

/** Volts minted to the operator's account. */
export const OPERATOR_VOLTS = 25_000;

/**
 * The operator's kit: one drone per art tier, each with a skin that renders on it (legendary on
 * any tier; Dragon Scale and Chrome Fury have tier 4 renders) and a mod on its build's heaviest
 * stats, plus unbound skins and mods of every rarity above common.
 * @type {Kit}
 */
const operatorKit = {
  drones: [
    // Samurai; Grip Coating (+4 turning).
    { name: 'AURORA-K5', level: 5, build: 'turning', skins: [31], mods: [12] },
    // Kraken; Typhoon Module (+8 rain handling).
    { name: 'BANSHEE-R1', level: 10, build: 'weather', skins: [29], mods: [21] },
    // Celestial; Quantum Sync (turn noise from consistency).
    { name: 'ARCANE-V7', level: 15, build: 'endurance', skins: [26], mods: [25] },
    // Dragon Scale and Chrome Fury; Phantom Drive (no battery fade on lap 1) and Stealth Aero.
    { name: 'APEX-Z9', level: 20, build: 'speed', skins: [18, 11], mods: [24, 20] },
  ],
  // Apex Predator; Obsidian Core, Frozen Abyss; Arctic Fury, Jade Circuit.
  skins: [25, 22, 19, 10, 14],
  // Storm Rider; Plasma Core, Predator Lens; Turbo Intake, Night Optics.
  mods: [26, 19, 22, 15, 14],
  volts: OPERATOR_VOLTS,
  // Top tier first: with one active slot the level 20 drone races.
  active: ['APEX-Z9', 'ARCANE-V7', 'BANSHEE-R1', 'AURORA-K5'],
  prices: {},
};
export const OPERATOR_KIT = Object.freeze(operatorKit);

/**
 * The four pilot accounts. Each lists one drone and four unbound items, priced near the rarity
 * base (10): 6 legendary skins, 3 epic, 3 rare, and 4 mods across them. Each also keeps one
 * unlisted drone with a skin that renders on its tier and a mod, set active, one per level
 * bracket (2.3), so each of the operator's drones has a player opponent in its bracket.
 * @type {readonly PilotDef[]}
 */
export const PILOTS = Object.freeze([
  {
    username: 'PILOT_ECHO',
    // Obsidian Core (tier 4 render); Stealth Aero.
    drone: { name: 'AEGIS-M4', level: 20, build: 'balanced', skins: [22], mods: [20] },
    // Frozen Abyss (tier 4 render); Iron Hull.
    racer: { name: 'BARON-F8', level: 18, build: 'turning', skins: [19], mods: [23] },
    listings: [
      { kind: 'skin', template: 25, price: 12_500 }, // Apex Predator
      { kind: 'skin', template: 28, price: 11_800 }, // Gilded Throne
      { kind: 'skin', template: 17, price: 3_600 }, // Crystal Phantom
      { kind: 'mod', template: 24, price: 12_000 }, // Phantom Drive
    ],
  },
  {
    username: 'PILOT_NOVA',
    // Necromancer; Aero Shell.
    drone: { name: 'AZURE-T2', level: 14, build: 'speed', skins: [30], mods: [11] },
    // Diamond Hands; Storm Plating.
    racer: { name: 'BANDIT-C2', level: 13, build: 'weather', skins: [27], mods: [13] },
    listings: [
      { kind: 'skin', template: 26, price: 12_200 }, // Celestial
      { kind: 'skin', template: 18, price: 3_400 }, // Dragon Scale
      { kind: 'skin', template: 11, price: 850 }, // Chrome Fury
      { kind: 'mod', template: 23, price: 3_500 }, // Iron Hull
    ],
  },
  {
    username: 'PILOT_KILO',
    // Grip Coating.
    drone: { name: 'BLADE-H6', level: 9, build: 'turning', skins: [], mods: [12] },
    // Valiant; Aero Shell.
    racer: { name: 'ASH-N7', level: 8, build: 'speed', skins: [32], mods: [11] },
    listings: [
      { kind: 'skin', template: 27, price: 12_900 }, // Diamond Hands
      { kind: 'skin', template: 29, price: 11_500 }, // Kraken
      { kind: 'skin', template: 12, price: 780 }, // Copper King
      { kind: 'mod', template: 21, price: 3_700 }, // Typhoon Module
    ],
  },
  {
    username: 'PILOT_ZULU',
    // Stabilizer Brace.
    drone: { name: 'ARGON-D3', level: 5, build: 'endurance', skins: [], mods: [18] },
    // Gilded Throne; Turbo Intake.
    racer: { name: 'AMP-Q1', level: 4, build: 'balanced', skins: [28], mods: [15] },
    listings: [
      { kind: 'skin', template: 32, price: 12_000 }, // Valiant
      { kind: 'skin', template: 24, price: 3_300 }, // Void Bloom
      { kind: 'skin', template: 16, price: 820 }, // Titanium Ghost
      { kind: 'mod', template: 16, price: 800 }, // Endurance Core
    ],
  },
]);

/** The pilots' `users.email`, by which a second run finds its accounts. */
export const pilotEmail = (/** @type {PilotDef} */ pilot) =>
  `${pilot.username.toLowerCase()}@showcase.hyperdrome.invalid`;

/**
 * Name and rarity of a catalog skin or a mod.
 * @param {'skin' | 'mod'} kind
 * @param {number} template
 * @returns {{ name: string, rarity: Rarity }}
 */
export function itemInfo(kind, template) {
  const t = kind === 'skin' ? skinTemplate(template) : modTemplate(template);
  if (!t) throw new Error(`unknown ${kind} template ${template}`);
  return { name: t.name, rarity: /** @type {Rarity} */ (t.rarity) };
}

/**
 * A drone's stat line: TSB(level) points along its build, each stat under cap(level).
 * @param {DroneSpec} drone
 * @returns {number[]}
 */
export function droneStats({ level, build }) {
  const stats = STAT_KEYS.map(() => 1);
  return allocateAlongPersona({ stats, level, weights: BUILDS[build] }).stats;
}

/**
 * The listing price of a drone: 3,500 + 500 per level above 1 + the base price of each bound item.
 * @param {DroneSpec} drone
 */
export function dronePrice(drone) {
  const base = (/** @type {'skin' | 'mod'} */ kind, /** @type {number} */ template) =>
    RARITY_BASE_PRICE[itemInfo(kind, template).rarity];
  return (
    DRONE_BASE_PRICE +
    DRONE_PRICE_PER_LEVEL * (drone.level - 1) +
    drone.skins.reduce((sum, t) => sum + base('skin', t), 0) +
    drone.mods.reduce((sum, t) => sum + base('mod', t), 0)
  );
}

/**
 * A pilot's kit: the drone it lists and the drone it races, each with its bound items, the
 * unbound items it lists, and every price.
 * @param {PilotDef} pilot
 * @returns {Kit}
 */
export function pilotKit(pilot) {
  /** @type {Record<string, number>} */
  const prices = { [droneKey(pilot.drone)]: dronePrice(pilot.drone) };
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const { kind, template, price } of pilot.listings) {
    const n = seen.get(`${kind}:${template}`) ?? 0;
    seen.set(`${kind}:${template}`, n + 1);
    prices[itemKey(kind, template, n)] = price;
  }
  const of = (/** @type {'skin' | 'mod'} */ kind) =>
    pilot.listings.filter((l) => l.kind === kind).map((l) => l.template);
  return {
    drones: [pilot.drone, pilot.racer],
    skins: of('skin'),
    mods: of('mod'),
    volts: 0,
    active: [pilot.racer.name],
    prices,
  };
}

/** @param {{ name: string }} drone the piece key of a drone, by its name */
export const droneKey = (drone) => `drone:${drone.name}`;
/**
 * @param {'skin' | 'mod'} kind
 * @param {number} template
 * @param {number} n the count of earlier unbound pieces of the same template in the kit
 */
const itemKey = (kind, template, n) => `${kind}:${template}:${n}`;

/**
 * The steps of a kit, in the order they are sent: every mint (drones, their bound items, the
 * unbound items, then Volts), every bind, every listing.
 * @param {Kit} kit
 * @returns {Step[]}
 */
export function kitSteps(kit) {
  /** @type {Step[]} */
  const mints = [];
  /** @type {Step[]} */
  const binds = [];
  /**
   * @param {string} key
   * @param {'skin' | 'mod'} kind
   * @param {number} template
   */
  const mintItem = (key, kind, template) => {
    const { name, rarity } = itemInfo(kind, template);
    mints.push({
      key,
      method: 'mint_item',
      label: `${rarity} ${kind} ${name}`,
      args: { kind, template, placeholder_name: null },
    });
    return name;
  };
  for (const drone of kit.drones) {
    const dKey = droneKey(drone);
    mints.push({
      key: dKey,
      method: 'mint_drone',
      label: `drone ${drone.name}, level ${drone.level}, ${drone.build} build`,
      args: {
        name: drone.name,
        level: drone.level,
        stats: droneStats(drone),
        active_hint: false,
      },
    });
    for (const kind of /** @type {const} */ (['skin', 'mod'])) {
      for (const template of kind === 'skin' ? drone.skins : drone.mods) {
        const key = `${dKey}:${kind}:${template}`;
        const name = mintItem(key, kind, template);
        binds.push({
          key: `bind:${key}`,
          method: 'bind',
          label: `bind ${name} to ${drone.name}`,
          piece: key,
          drone: dKey,
        });
      }
    }
  }
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const kind of /** @type {const} */ (['skin', 'mod'])) {
    for (const template of kind === 'skin' ? kit.skins : kit.mods) {
      const n = seen.get(`${kind}:${template}`) ?? 0;
      seen.set(`${kind}:${template}`, n + 1);
      mintItem(itemKey(kind, template, n), kind, template);
    }
  }
  if (kit.volts > 0) {
    mints.push({
      key: 'volts',
      method: 'mint_volts',
      label: `${kit.volts.toLocaleString('en-US')} Volts`,
      args: { amount: String(kit.volts) },
    });
  }
  /** @type {Step[]} */
  const lists = mints
    .filter((m) => kit.prices[m.key] !== undefined)
    .map((m) => ({
      key: `list:${m.key}`,
      method: 'list',
      label: `list ${m.label} at ${kit.prices[m.key].toLocaleString('en-US')} Volts`,
      piece: m.key,
      price: kit.prices[m.key],
    }));
  return [...mints, ...binds, ...lists];
}

/** The RFC 9562 DNS namespace. */
const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
/** Namespace of every showcase action id. */
export const SHOWCASE_ACTION_NAMESPACE = uuidV5(NAMESPACE_DNS, 'showcase.hyperdrome');

/**
 * The action id of a step for an account: the same step always carries the same id, so the action
 * paths (8) replay it and never send it twice.
 * @param {string} accountId the NEAR account the step is for
 * @param {string} stepKey
 */
export function showcaseActionId(accountId, stepKey) {
  return uuidV5(SHOWCASE_ACTION_NAMESPACE, `${accountId}:${stepKey}`);
}

/**
 * How many of each skin template the whole plan mints, to check against the on-chain caps.
 * @returns {Map<number, number>}
 */
export function plannedSkinMints() {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const kit of [OPERATOR_KIT, ...PILOTS.map(pilotKit)]) {
    for (const template of [...kit.drones.flatMap((d) => d.skins), ...kit.skins]) {
      counts.set(template, (counts.get(template) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Per-stat cap and budget check of a drone's stat line, as `mint_drone` enforces them (4.4).
 * @param {DroneSpec} drone
 */
export function droneFits(drone) {
  const stats = droneStats(drone);
  const cap = calculatePerStatCap(drone.level);
  return (
    stats.every((s) => s >= 1 && s <= cap) &&
    stats.reduce((a, b) => a + b, 0) <= calculateTSB(drone.level)
  );
}
