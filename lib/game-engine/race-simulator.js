/**
 * Race simulator (SPEC.md 2.4 and 5). Pure: the same seed, race id, drones, track and conditions
 * always give the same result. Every random number comes from the race PRNG in the baseline draw
 * order: per lap, straight stretch sizes, straight shuffle, turn stretch sizes, turn shuffle, start
 * type; per segment, subtype, jitter, noise A, noise B; the tie-break last.
 */

import { batteryFadeApplies, conditionMultiplier, noiseFactor } from './mods.js';
import { fromSeed } from './prng.js';

/** @typedef {import('./mods.js').RaceDrone} RaceDrone */
/** @typedef {import('./templates.js').StatKey} StatKey */
/** @typedef {'straight' | 'turn'} SegmentType */
/** @typedef {'short' | 'medium' | 'long'} TrackLength */

/**
 * @typedef {object} Track
 * @property {number} straights
 * @property {number} turns
 * @property {number} [difficulty] 1-10; 5 when missing
 * @property {TrackLength | string} [length] battery fade multiplier; medium when missing
 */

/**
 * @typedef {object} RaceInput
 * @property {string} seed batch seed, 32 bytes as hex
 * @property {string} raceId `"<batchId>:<index>"`
 * @property {RaceDrone} droneA effective stats after the mod, plus its special
 * @property {RaceDrone} droneB
 * @property {Track} track
 * @property {string} weather one of WEATHER
 * @property {string} timeOfDay one of TIME_OF_DAY
 */

/** @typedef {{ lap: number, type: SegmentType, gapMs: number }} LogEntry */
/** @typedef {{ winner: 'a' | 'b', timeAms: number, timeBms: number, log: LogEntry[] }} RaceResult */

/**
 * @typedef {object} TraceSegment
 * @property {number} lap
 * @property {SegmentType} type
 * @property {string} subtype
 * @property {number} scoreA
 * @property {number} scoreB
 * @property {number} timeA seconds
 * @property {number} timeB seconds
 */

export const WEATHER = Object.freeze([
  'clear',
  'clouds',
  'rain',
  'heavy_rain',
  'wind',
  'haze',
  'fog',
]);
export const TIME_OF_DAY = Object.freeze(['dawn', 'day', 'dusk', 'night']);

export const LAPS = 3;
const MIN_STRETCH = 2;
const MAX_STRETCH = 4;
const JITTER = 0.06;
const SCORE_TIME_SLOPE = 0.007;
export const MIN_SEGMENT_TIME = 0.8;
export const MAX_SEGMENT_TIME = 8.0;
export const SCORE_FLOOR = 0.1;
const BATTERY_FADE = 0.85;
const NOISE = { straight: 0.03, turn: 0.06 };
const DEFAULT_DIFFICULTY = 5;

/** @type {Record<string, number>} */
const LENGTH_BATTERY_MULTIPLIER = { short: 0.8, medium: 1.0, long: 1.2 };

/** @type {Record<string, { type: SegmentType, baseMultiplier: number, statBias: [StatKey, number][] }>} */
export const SEGMENT_SUBTYPES = {
  short_burst: {
    type: 'straight',
    baseMultiplier: 0.6,
    statBias: [
      ['acceleration', 0.5],
      ['speed', 0.3],
      ['windResistance', 0.2],
    ],
  },
  standard_str: {
    type: 'straight',
    baseMultiplier: 1.0,
    statBias: [
      ['speed', 0.5],
      ['acceleration', 0.3],
      ['windResistance', 0.2],
    ],
  },
  long_straight: {
    type: 'straight',
    baseMultiplier: 1.4,
    statBias: [
      ['speed', 0.6],
      ['acceleration', 0.2],
      ['windResistance', 0.2],
    ],
  },
  gentle_curve: {
    type: 'turn',
    baseMultiplier: 0.7,
    statBias: [
      ['turning', 0.4],
      ['acceleration', 0.3],
      ['durability', 0.3],
    ],
  },
  standard_turn: {
    type: 'turn',
    baseMultiplier: 1.0,
    statBias: [
      ['turning', 0.5],
      ['durability', 0.3],
      ['acceleration', 0.2],
    ],
  },
  sharp_hairpin: {
    type: 'turn',
    baseMultiplier: 1.3,
    statBias: [
      ['turning', 0.6],
      ['durability', 0.3],
      ['acceleration', 0.1],
    ],
  },
  chicane: {
    type: 'turn',
    baseMultiplier: 0.9,
    statBias: [
      ['acceleration', 0.4],
      ['turning', 0.4],
      ['durability', 0.2],
    ],
  },
};

const SUBTYPES_BY_TYPE = {
  straight: ['short_burst', 'standard_str', 'long_straight'],
  turn: ['gentle_curve', 'standard_turn', 'sharp_hairpin', 'chicane'],
};

/**
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Fisher-Yates shuffle of a copy.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rand
 * @returns {T[]}
 */
function shuffle(arr, rand) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Split `n` segments into runs of 2-4, never leaving a run of 1. One draw per run except the last.
 * @param {number} n
 * @param {() => number} rand
 * @returns {number[]}
 */
function splitIntoStretches(n, rand) {
  if (n <= 0) return [];
  if (n < MIN_STRETCH) return [n];
  const sizes = [];
  let remaining = n;
  while (remaining > 0) {
    if (remaining <= MAX_STRETCH) {
      sizes.push(remaining);
      break;
    }
    const upper = Math.min(MAX_STRETCH, remaining - MIN_STRETCH);
    const size = MIN_STRETCH + Math.floor(rand() * (upper - MIN_STRETCH + 1));
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

/**
 * One lap's segment order: runs of straights and turns alternating from a random start type.
 * @param {Track} track
 * @param {() => number} rand
 * @returns {SegmentType[]}
 */
function buildSegments(track, rand) {
  const straights = shuffle(splitIntoStretches(track.straights, rand), rand);
  const turns = shuffle(splitIntoStretches(track.turns, rand), rand);
  /** @type {SegmentType} */
  let nextType = rand() < 0.5 ? 'straight' : 'turn';
  /** @type {SegmentType[]} */
  const segments = [];
  while (straights.length > 0 || turns.length > 0) {
    const pool = nextType === 'straight' ? straights : turns;
    const size = pool.shift();
    if (size !== undefined) {
      for (let i = 0; i < size; i++) segments.push(nextType);
    }
    nextType = nextType === 'straight' ? 'turn' : 'straight';
  }
  return segments;
}

/**
 * Score multipliers for the race's conditions, in baseline order (night, then the weather).
 * @param {RaceDrone} drone
 * @param {string} weather
 * @param {string} timeOfDay
 * @returns {number[]}
 */
function conditionMultipliers(drone, weather, timeOfDay) {
  const out = [];
  if (timeOfDay === 'night') out.push(clamp(drone.nightVision / 50, 0.5, 1.5));
  if (weather === 'rain') out.push(clamp(drone.rainHandling / 50, 0.5, 1.5));
  else if (weather === 'heavy_rain') out.push(clamp(drone.rainHandling / 60, 0.4, 1.4));
  if (weather === 'wind') out.push(clamp(drone.windResistance / 50, 0.5, 1.5));
  if (weather === 'fog') out.push(clamp(drone.nightVision / 60, 0.6, 1.4));
  else if (weather === 'haze') out.push(clamp(drone.nightVision / 70, 0.7, 1.3));
  return out;
}

/**
 * Performance score of one drone on one segment (SPEC.md 2.4), with the legendary specials.
 * @param {RaceDrone} drone
 * @param {string} subtypeName
 * @param {number} lap 1-based
 * @param {number} lengthMultiplier
 * @param {string} weather
 * @param {string} timeOfDay
 * @returns {number}
 */
export function scoreSegment(drone, subtypeName, lap, lengthMultiplier, weather, timeOfDay) {
  let score = 0;
  for (const [statKey, weight] of SEGMENT_SUBTYPES[subtypeName].statBias) {
    score += (drone[statKey] || 0) * weight;
  }
  for (const m of conditionMultipliers(drone, weather, timeOfDay)) {
    score *= conditionMultiplier(m, drone.special);
  }
  if (batteryFadeApplies(lap, drone.special)) {
    const lapFraction = lap / LAPS;
    const degradation =
      BATTERY_FADE *
      lapFraction *
      lapFraction *
      lapFraction *
      (1 - drone.batteryCapacity / 100) *
      lengthMultiplier;
    score *= 1 - degradation;
  }
  return Math.max(score, SCORE_FLOOR);
}

/**
 * Segment time in seconds before noise: clamp(base * multiplier - 0.007 * score, 0.8, 8.0).
 * @param {number} score
 * @param {number} difficulty
 * @param {SegmentType} type
 * @param {number} timeMultiplier subtype multiplier times jitter
 * @returns {number}
 */
function scoreToTime(score, difficulty, type, timeMultiplier) {
  const base = type === 'straight' ? 1.0 + 0.2 * difficulty : 1.8 + 0.4 * difficulty;
  return clamp(
    base * timeMultiplier - SCORE_TIME_SLOPE * score,
    MIN_SEGMENT_TIME,
    MAX_SEGMENT_TIME
  );
}

/**
 * Full race trace: every segment's subtype, scores and times, the float totals and the winner.
 * Server-side only; `simulateRace` returns the client-safe view.
 * @param {RaceInput} input
 * @returns {{ segments: TraceSegment[], totalA: number, totalB: number, log: LogEntry[], result: RaceResult }}
 */
export function traceRace({ seed, raceId, droneA, droneB, track, weather, timeOfDay }) {
  const rand = fromSeed(seed, raceId).nextUnit;
  const lengthMultiplier = LENGTH_BATTERY_MULTIPLIER[track.length ?? 'medium'] ?? 1.0;
  const difficulty = Number(track.difficulty) || DEFAULT_DIFFICULTY;
  /** @type {TraceSegment[]} */
  const segments = [];
  /** @type {LogEntry[]} */
  const log = [];
  let totalA = 0;
  let totalB = 0;

  for (let lap = 1; lap <= LAPS; lap++) {
    for (const type of buildSegments(track, rand)) {
      const pool = SUBTYPES_BY_TYPE[type];
      const subtype = pool[Math.floor(rand() * pool.length)];
      const jitter = 1.0 + (rand() - 0.5) * JITTER;
      const timeMultiplier = SEGMENT_SUBTYPES[subtype].baseMultiplier * jitter;

      const scoreA = scoreSegment(droneA, subtype, lap, lengthMultiplier, weather, timeOfDay);
      const scoreB = scoreSegment(droneB, subtype, lap, lengthMultiplier, weather, timeOfDay);
      const noiseA =
        (rand() - 0.5) * 2 * NOISE[type] * noiseFactor(droneA.consistency, type, droneA.special);
      const noiseB =
        (rand() - 0.5) * 2 * NOISE[type] * noiseFactor(droneB.consistency, type, droneB.special);
      const timeA = clamp(
        scoreToTime(scoreA, difficulty, type, timeMultiplier) + noiseA,
        MIN_SEGMENT_TIME,
        MAX_SEGMENT_TIME
      );
      const timeB = clamp(
        scoreToTime(scoreB, difficulty, type, timeMultiplier) + noiseB,
        MIN_SEGMENT_TIME,
        MAX_SEGMENT_TIME
      );

      totalA += timeA;
      totalB += timeB;
      segments.push({ lap, type, subtype, scoreA, scoreB, timeA, timeB });
      log.push({ lap, type, gapMs: Math.round((totalA - totalB) * 1000) });
    }
  }

  const timeAms = Math.round(totalA * 1000);
  const timeBms = Math.round(totalB * 1000);
  /** @type {'a' | 'b'} */
  let winner;
  if (timeAms < timeBms) winner = 'a';
  else if (timeBms < timeAms) winner = 'b';
  else winner = rand() < 0.5 ? 'a' : 'b';

  return { segments, totalA, totalB, log, result: { winner, timeAms, timeBms, log } };
}

/**
 * Simulate a 1v1 race (SPEC.md 5). Times are integer milliseconds of the summed segment times; the
 * log holds only the lap, segment type and cumulative gap (A minus B) per segment.
 * @param {RaceInput} input
 * @returns {RaceResult}
 */
export function simulateRace(input) {
  return traceRace(input).result;
}

/**
 * A weather drawn uniformly with `rand` (a function returning [0, 1)).
 * @param {() => number} rand
 * @returns {string}
 */
export function randomWeather(rand) {
  return WEATHER[Math.floor(rand() * WEATHER.length)];
}

/**
 * A time of day drawn uniformly with `rand`.
 * @param {() => number} rand
 * @returns {string}
 */
export function randomTimeOfDay(rand) {
  return TIME_OF_DAY[Math.floor(rand() * TIME_OF_DAY.length)];
}
