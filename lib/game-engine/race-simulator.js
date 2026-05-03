/**
 * Drone Manager - race simulator.
 *
 * Pure function: given two drones, a track, weather, and time of day,
 * return a deterministic-ish race result (deterministic given the same
 * random seed). No DB access. Used by `race.service.js` during race cycles.
 */

/**
 * Shuffle an array in place (Fisher-Yates).
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Split a count of segments into stretches of size MIN_STRETCH..MAX_STRETCH.
 * Stretch sizes are randomized per call. Always uses up exactly `n`. If
 * `n` is below MIN_STRETCH it becomes a single short stretch (rare on
 * real tracks; covers tiny edge cases without throwing).
 *
 * The "remaining must leave room for another full stretch" check prevents
 * cases like remaining=5, size=4 which would leave a stranded size-1
 * tail. We bias each pick so the leftover is either 0 or >= MIN_STRETCH.
 *
 * @param {number} n
 * @returns {number[]} stretch sizes, sums to n
 */
function splitIntoStretches(n) {
  const MIN_STRETCH = 2;
  const MAX_STRETCH = 4;
  if (n <= 0) return [];
  if (n < MIN_STRETCH) return [n];
  const sizes = [];
  let remaining = n;
  while (remaining > 0) {
    if (remaining <= MAX_STRETCH) {
      sizes.push(remaining);
      break;
    }
    // remaining > MAX_STRETCH, so we MUST take less than remaining.
    // size must also leave remaining' >= MIN_STRETCH so the next stretch
    // is valid. That gives size in [MIN_STRETCH, remaining - MIN_STRETCH],
    // capped at MAX_STRETCH.
    const upper = Math.min(MAX_STRETCH, remaining - MIN_STRETCH);
    const size = MIN_STRETCH + Math.floor(Math.random() * (upper - MIN_STRETCH + 1));
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

/**
 * Build an ordered segment list from a track. Segments are grouped into
 * clustered stretches of 2-4 consecutive same-type segments instead of
 * a fully random shuffle. The straight and turn stretches alternate
 * starting from a random type, so the lap reads as a sequence of
 * speed-favoring then turn-favoring runs. This produces natural swings
 * in cumulative gap during a race: the speed drone builds a lead during
 * a straight stretch, the turn drone claws it back during a turn stretch.
 *
 * If one type runs out before the other (imbalanced track), the
 * remaining stretches of the other type are appended in order.
 *
 * @param {{ straights: number, turns: number }} track
 * @returns {Array<'straight'|'turn'>}
 */
function buildSegments(track) {
  const sStretches = shuffle(splitIntoStretches(track.straights));
  const tStretches = shuffle(splitIntoStretches(track.turns));

  let nextType = Math.random() < 0.5 ? 'straight' : 'turn';
  const segments = [];

  while (sStretches.length > 0 || tStretches.length > 0) {
    if (nextType === 'straight' && sStretches.length > 0) {
      const size = sStretches.shift();
      for (let i = 0; i < size; i++) segments.push('straight');
      nextType = 'turn';
    } else if (nextType === 'turn' && tStretches.length > 0) {
      const size = tStretches.shift();
      for (let i = 0; i < size; i++) segments.push('turn');
      nextType = 'straight';
    } else {
      // The desired next type is exhausted; flip and continue with the
      // other type's remaining stretches.
      nextType = nextType === 'straight' ? 'turn' : 'straight';
    }
  }
  return segments;
}

/** Clamp helper. */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Forced lap count for every race. 3 laps is the production default
 * (matches `track.laps` for every seeded track). The hidden setter
 * `__setForcedLaps` is a test-only escape hatch so the engine harness
 * can sweep alternate lap counts for offline experiments. Production
 * code never calls it.
 */
let FORCED_LAPS = 3;
export function __setForcedLaps(n) {
  FORCED_LAPS = Math.max(1, Number(n) || 3);
}

/**
 * Track-length multiplier applied to battery degradation. Short tracks
 * are gentle on battery, long tracks punish low-Battery builds. Driven
 * from the `tracks.length` enum which would otherwise be visual-only.
 */
const LENGTH_BATTERY_MULTIPLIER = {
  short:  0.8,
  medium: 1.0,
  long:   1.2,
};

/**
 * Score-to-time conversion. Bounded linear: every score point shaves a
 * small fixed amount off the segment's base time.
 *
 * v2: base time is per-segment-type (turns slower than straights) AND
 * per-subtype (sharp_hairpin slower than gentle_curve, etc.). The subtype
 * pick happens in simulateRace; here we just multiply the base into the
 * per-instance multiplier.
 */
const SCORE_TIME_SLOPE = 0.007;
const MIN_SEGMENT_TIME = 0.8;
const MAX_SEGMENT_TIME = 8.0;

/**
 * Named segment subtypes. Each has a `baseMultiplier` applied to the
 * segment's base time, and a `statBias` map that determines which stats
 * matter for the score on that subtype.
 *
 * Stat keys must match the camelCase columns on the drones table.
 */
const SEGMENT_SUBTYPES = {
  short_burst:   { type: 'straight', baseMultiplier: 0.60, statBias: { acceleration: 0.5, speed: 0.3, windResistance: 0.2 } },
  standard_str:  { type: 'straight', baseMultiplier: 1.00, statBias: { speed: 0.5, acceleration: 0.3, windResistance: 0.2 } },
  long_straight: { type: 'straight', baseMultiplier: 1.40, statBias: { speed: 0.6, acceleration: 0.2, windResistance: 0.2 } },
  gentle_curve:  { type: 'turn',     baseMultiplier: 0.70, statBias: { turning: 0.4, acceleration: 0.3, durability: 0.3 } },
  standard_turn: { type: 'turn',     baseMultiplier: 1.00, statBias: { turning: 0.5, durability: 0.3, acceleration: 0.2 } },
  sharp_hairpin: { type: 'turn',     baseMultiplier: 1.30, statBias: { turning: 0.6, durability: 0.3, acceleration: 0.1 } },
  chicane:       { type: 'turn',     baseMultiplier: 0.90, statBias: { acceleration: 0.4, turning: 0.4, durability: 0.2 } },
};

const STRAIGHT_SUBTYPE_NAMES = ['short_burst', 'standard_str', 'long_straight'];
const TURN_SUBTYPE_NAMES = ['gentle_curve', 'standard_turn', 'sharp_hairpin', 'chicane'];

/**
 * Pick a random subtype name for the given parent type. Tracks don't yet
 * have a character field, so distribution is uniform within the pool.
 * @param {'straight'|'turn'} type
 * @returns {string}
 */
function pickSubtype(type) {
  const pool = type === 'straight' ? STRAIGHT_SUBTYPE_NAMES : TURN_SUBTYPE_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * @param {'straight'|'turn'} type
 * @param {number} difficulty
 * @returns {number} base time in seconds before subtype + jitter + score reduction
 */
function baseTimeFor(type, difficulty) {
  return type === 'straight' ? 1.0 + 0.20 * difficulty : 1.8 + 0.40 * difficulty;
}

/**
 * Convert a per-segment performance score into a segment time in seconds.
 * @param {number} score - output of scoreSegment
 * @param {number} difficulty - track difficulty 1..10
 * @param {'straight'|'turn'} type
 * @param {number} timeMultiplier - subtype.baseMultiplier × per-instance jitter
 * @returns {number} segment time in seconds
 */
function scoreToTime(score, difficulty, type, timeMultiplier) {
  const baseTime = baseTimeFor(type, difficulty) * timeMultiplier;
  return clamp(baseTime - SCORE_TIME_SLOPE * score, MIN_SEGMENT_TIME, MAX_SEGMENT_TIME);
}

/**
 * Compute the performance score for a drone on one segment.
 * Stat weights come from the subtype's `statBias` map (set by Captain).
 *
 * @param {object} drone - camelCase stat fields
 * @param {string} subtypeName - key into SEGMENT_SUBTYPES
 * @param {number} currentLap - 1-indexed lap number (1..totalLaps)
 * @param {number} totalLaps
 * @param {number} lengthMultiplier - 0.8 / 1.0 / 1.2 from the track's length
 * @param {string} weather
 * @param {string} timeOfDay
 * @returns {number}
 */
function scoreSegment(
  drone,
  subtypeName,
  currentLap,
  totalLaps,
  lengthMultiplier,
  weather,
  timeOfDay,
) {
  const subtype = SEGMENT_SUBTYPES[subtypeName];
  let score = 0;
  for (const [statKey, weight] of Object.entries(subtype.statBias)) {
    score += (drone[statKey] || 0) * weight;
  }

  // Night vision modifier
  if (timeOfDay === 'night') {
    const nightMultiplier = clamp(drone.nightVision / 50, 0.5, 1.5);
    score *= nightMultiplier;
  }

  // Rain handling modifier
  if (weather === 'rain') {
    const rainMultiplier = clamp(drone.rainHandling / 50, 0.5, 1.5);
    score *= rainMultiplier;
  } else if (weather === 'heavy_rain') {
    // Heavy rain hits harder than rain: tighter divisor + tighter clamp,
    // so a low-rainHandling drone bottoms out lower (0.4 vs 0.5) and a
    // top-rainHandling drone tops out lower (1.4 vs 1.5). Net effect:
    // rain handling matters more, raw speed matters less.
    const rainMultiplier = clamp(drone.rainHandling / 60, 0.4, 1.4);
    score *= rainMultiplier;
  }

  // Wind resistance modifier - widened to match rain/night so a wind
  // specialist gains as much as a rain specialist does.
  if (weather === 'wind') {
    const windMultiplier = clamp(drone.windResistance / 50, 0.5, 1.5);
    score *= windMultiplier;
  }

  // Fog / haze: visibility-limited weather, scaled off nightVision since
  // it's the same "see the track" stat. Fog is the harsher of the two;
  // haze is a light visibility hit.
  if (weather === 'fog') {
    const fogMultiplier = clamp(drone.nightVision / 60, 0.6, 1.4);
    score *= fogMultiplier;
  } else if (weather === 'haze') {
    const hazeMultiplier = clamp(drone.nightVision / 70, 0.7, 1.3);
    score *= hazeMultiplier;
  }

  // v2: cubic battery fade. Early laps barely drain, final lap can hit
  // -85% on a 0-battery long-track build. Late-race pace drops sharply
  // rather than ramping linearly or quadratically.
  const lapFraction = currentLap / totalLaps;
  const degradation =
    0.85 * lapFraction * lapFraction * lapFraction * (1 - drone.batteryCapacity / 100) * lengthMultiplier;
  score *= 1 - degradation;

  // v2: variance moved from score-space to time-space (added in
  // simulateRace after scoreToTime). Score is returned raw here.
  return Math.max(score, 0.1);
}

/**
 * Simulate a 1v1 race between two drones on one track under given conditions.
 *
 * The race runs FORCED_LAPS laps (default 3; `track.laps` is ignored).
 * Segments are re-clustered at the START of every lap (see buildSegments)
 * so a "lucky" arrangement can't carry advantage across all laps — each
 * lap is a fresh stretch ordering of the track's straights + turns.
 * Weather and time-of-day are fixed for the whole race; battery degradation
 * scales per lap (see scoreSegment).
 *
 * @param {object} drone1
 * @param {object} drone2
 * @param {{ straights: number, turns: number, laps?: number, difficulty?: number, length?: string, id?: string, name?: string }} track
 * @param {string} weather - 'clear'|'clouds'|'rain'|'heavy_rain'|'wind'|'haze'|'fog'
 * @param {string} timeOfDay - 'dawn'|'day'|'dusk'|'night'
 * @returns {{
 *   winnerId: string,
 *   drone1Time: number,
 *   drone2Time: number,
 *   laps: number,
 *   raceLog: Array<{
 *     segment: number,
 *     lap: number,
 *     type: 'straight'|'turn',
 *     subtype: string,
 *     drone1Score: number,
 *     drone2Score: number,
 *     drone1Time: number,
 *     drone2Time: number
 *   }>
 * }}
 */
export function simulateRace(drone1, drone2, track, weather, timeOfDay) {
  const totalLaps = FORCED_LAPS;
  const lengthMultiplier =
    LENGTH_BATTERY_MULTIPLIER[track.length] ?? 1.0;
  const difficulty = Number(track.difficulty) || 5;
  const log = [];
  let time1 = 0;
  let time2 = 0;
  let globalSegment = 0;

  for (let lap = 1; lap <= totalLaps; lap++) {
    // Fresh shuffle per lap so segment order isn't a fixed advantage
    // across the whole race.
    const segments = buildSegments(track);
    for (let i = 0; i < segments.length; i++) {
      const type = segments[i];

      // v2: pick a subtype (sets baseMultiplier + statBias). ±3% jitter
      // on top so two same-subtype segments aren't identical. Same
      // baseMultiplier applies to both drones — it's the segment itself.
      const subtype = pickSubtype(type);
      const jitter = 1.0 + (Math.random() - 0.5) * 0.06;
      const timeMultiplier = SEGMENT_SUBTYPES[subtype].baseMultiplier * jitter;

      const s1 = scoreSegment(drone1, subtype, lap, totalLaps, lengthMultiplier, weather, timeOfDay);
      const s2 = scoreSegment(drone2, subtype, lap, totalLaps, lengthMultiplier, weather, timeOfDay);
      let t1 = scoreToTime(s1, difficulty, type, timeMultiplier);
      let t2 = scoreToTime(s2, difficulty, type, timeMultiplier);

      // v2: additive time noise per drone, dampened by consistency.
      // ±60ms on turns, ±30ms on straights at consistency=0.
      const baseNoise = type === 'turn' ? 0.06 : 0.03;
      const n1 = (Math.random() - 0.5) * 2 * baseNoise * (1 - drone1.consistency / 100);
      const n2 = (Math.random() - 0.5) * 2 * baseNoise * (1 - drone2.consistency / 100);
      t1 = clamp(t1 + n1, MIN_SEGMENT_TIME, MAX_SEGMENT_TIME);
      t2 = clamp(t2 + n2, MIN_SEGMENT_TIME, MAX_SEGMENT_TIME);

      time1 += t1;
      time2 += t2;
      globalSegment += 1;
      log.push({
        segment: globalSegment,
        lap,
        type,
        subtype,
        drone1Score: Number(s1.toFixed(2)),
        drone2Score: Number(s2.toFixed(2)),
        drone1Time: Number(t1.toFixed(4)),
        drone2Time: Number(t2.toFixed(4)),
      });
    }
  }

  let winnerId;
  if (time1 < time2) winnerId = drone1.id;
  else if (time2 < time1) winnerId = drone2.id;
  else winnerId = Math.random() < 0.5 ? drone1.id : drone2.id;

  return {
    winnerId,
    drone1Time: Number(time1.toFixed(4)),
    drone2Time: Number(time2.toFixed(4)),
    laps: totalLaps,
    raceLog: log,
  };
}

const WEATHER_CHOICES = ['clear', 'clouds', 'rain', 'heavy_rain', 'wind', 'haze', 'fog'];
const TIME_OF_DAY_CHOICES = ['dawn', 'day', 'dusk', 'night'];

/** Pick a random weather value. */
export function randomWeather() {
  return WEATHER_CHOICES[Math.floor(Math.random() * WEATHER_CHOICES.length)];
}

/** Pick a random time-of-day value. */
export function randomTimeOfDay() {
  return TIME_OF_DAY_CHOICES[Math.floor(Math.random() * TIME_OF_DAY_CHOICES.length)];
}
