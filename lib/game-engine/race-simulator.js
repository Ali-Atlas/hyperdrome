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
 * small fixed amount off the segment's base time. Replaces the old
 * `time = 100 / score` (hyperbolic — exploded gaps at low levels). Keeps
 * per-segment differences in tenths of a second so variance, segment-type
 * swings, and battery fade can flip individual segments naturally.
 *
 * Calibration:
 *   - 5ms per score point  → ~50-pt skill gap = ~0.25s/seg = ~7s/race
 *   - difficulty scales the per-segment base time, not the gap
 *   - clamped against god-drone underflow and trash-drone overflow
 */
const SCORE_TIME_SLOPE = 0.005;
const MIN_SEGMENT_TIME = 0.8;
const MAX_SEGMENT_TIME = 8.0;

/**
 * Convert a per-segment performance score into a segment time in seconds.
 * @param {number} score - output of scoreSegment
 * @param {number} difficulty - track difficulty 1..10
 * @returns {number} segment time in seconds
 */
function scoreToTime(score, difficulty) {
  const baseTime = 1.6 + 0.33 * difficulty;
  return clamp(baseTime - SCORE_TIME_SLOPE * score, MIN_SEGMENT_TIME, MAX_SEGMENT_TIME);
}

/**
 * Compute the performance score for a drone on one segment.
 * @param {object} drone - camelCase stat fields
 * @param {'straight'|'turn'} segmentType
 * @param {number} currentLap - 1-indexed lap number (1..totalLaps)
 * @param {number} totalLaps
 * @param {number} lengthMultiplier - 0.8 / 1.0 / 1.2 from the track's length
 * @param {string} weather
 * @param {string} timeOfDay
 * @returns {number}
 */
function scoreSegment(
  drone,
  segmentType,
  currentLap,
  totalLaps,
  lengthMultiplier,
  weather,
  timeOfDay,
) {
  let score;
  if (segmentType === 'straight') {
    // Captain Apr 2026: consistency removed from segment scoring (it
    // remains a purely defensive stat via variance dampening below).
    // Straight weight redistributed into the segment-defining stats so
    // type specialists open a real gap on their type.
    score =
      drone.speed * 0.5 +
      drone.acceleration * 0.3 +
      drone.windResistance * 0.2;
  } else {
    score =
      drone.turning * 0.5 +
      drone.durability * 0.3 +
      drone.acceleration * 0.2;
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

  // Battery degradation: lap 1 is clean (drones are fresh), then ramps
  // linearly toward a max on the final lap. Long tracks drain harder via
  // lengthMultiplier, short tracks drain less.
  let degradation = 0;
  if (currentLap > 1 && totalLaps > 1) {
    const lapFactor = (currentLap - 1) / (totalLaps - 1);
    degradation =
      ((100 - drone.batteryCapacity) / 100) * 0.5 * lapFactor * lengthMultiplier;
  }
  score *= 1 - degradation;

  // Random variance, dampened by consistency. Captain Apr 2026: ceiling
  // bumped from 0.10 to 0.14 so the per-segment swing is ±7% at
  // consistency=0 (was ±5%). Combined with the segment-stat-redistribution
  // that pulled consistency out of base scoring, this gives lead changes
  // a real surface area without making well-matched races feel random.
  const varianceRange = 0.14 * (1 - drone.consistency / 100);
  const variance = 1 + (Math.random() * varianceRange - varianceRange / 2);
  score *= variance;

  // Guard against non-positive scores (very low-stat drones) so time is finite
  return Math.max(score, 0.1);
}

/**
 * Simulate a 1v1 race between two drones on one track under given conditions.
 *
 * The race runs `track.laps` laps. Segments are re-clustered at the START of
 * every lap (see buildSegments) so a "lucky" arrangement can't carry advantage
 * across all laps — each lap is a fresh stretch ordering of the track's
 * straights + turns.
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
 *     drone1Score: number,
 *     drone2Score: number,
 *     drone1Time: number,
 *     drone2Time: number
 *   }>
 * }}
 */
export function simulateRace(drone1, drone2, track, weather, timeOfDay) {
  const totalLaps = Math.max(1, Number(track.laps) || 3);
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
      const s1 = scoreSegment(drone1, type, lap, totalLaps, lengthMultiplier, weather, timeOfDay);
      const s2 = scoreSegment(drone2, type, lap, totalLaps, lengthMultiplier, weather, timeOfDay);
      const t1 = scoreToTime(s1, difficulty);
      const t2 = scoreToTime(s2, difficulty);
      time1 += t1;
      time2 += t2;
      globalSegment += 1;
      log.push({
        segment: globalSegment,
        lap,
        type,
        drone1Score: Number(s1.toFixed(2)),
        drone2Score: Number(s2.toFixed(2)),
        drone1Time: Number(t1.toFixed(4)),
        drone2Time: Number(t2.toFixed(4)),
      });
    }
  }

  const winnerId = time1 <= time2 ? drone1.id : drone2.id;
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
