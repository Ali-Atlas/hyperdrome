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
 * Build an ordered segment list from a track: one entry per straight or turn,
 * shuffled so the race isn't all straights then all turns.
 * @param {{ straights: number, turns: number }} track
 * @returns {Array<'straight'|'turn'>}
 */
function buildSegments(track) {
  const straights = Array(track.straights).fill('straight');
  const turns = Array(track.turns).fill('turn');
  return shuffle([...straights, ...turns]);
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
    score =
      drone.speed * 0.4 +
      drone.acceleration * 0.3 +
      drone.windResistance * 0.15 +
      drone.consistency * 0.15;
  } else {
    score =
      drone.turning * 0.4 +
      drone.durability * 0.25 +
      drone.acceleration * 0.2 +
      drone.consistency * 0.15;
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

  // Random variance, dampened by consistency
  const varianceRange = 0.1 * (1 - drone.consistency / 100);
  const variance = 1 + (Math.random() * varianceRange - varianceRange / 2);
  score *= variance;

  // Guard against non-positive scores (very low-stat drones) so time is finite
  return Math.max(score, 0.1);
}

/**
 * Simulate a 1v1 race between two drones on one track under given conditions.
 *
 * The race runs `track.laps` laps. Segments are re-shuffled at the START of
 * every lap so a "lucky" segment order can't carry advantage across all
 * laps — each lap is a fresh permutation of the track's straights + turns.
 * Weather and time-of-day are fixed for the whole race; battery degradation
 * scales per lap (see scoreSegment).
 *
 * @param {object} drone1
 * @param {object} drone2
 * @param {{ straights: number, turns: number, laps?: number, id?: string, name?: string }} track
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
      const t1 = 100 / s1;
      const t2 = 100 / s2;
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
