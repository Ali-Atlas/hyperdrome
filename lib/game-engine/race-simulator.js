/**
 * Drone Manager — race simulator.
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
 * Compute the performance score for a drone on one segment.
 * @param {object} drone - camelCase stat fields
 * @param {'straight'|'turn'} segmentType
 * @param {number} segmentIndex
 * @param {number} totalSegments
 * @param {string} weather
 * @param {string} timeOfDay
 * @returns {number}
 */
function scoreSegment(drone, segmentType, segmentIndex, totalSegments, weather, timeOfDay) {
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
  if (weather === 'rain' || weather === 'heavy_rain') {
    const rainMultiplier = clamp(drone.rainHandling / 50, 0.5, 1.5);
    score *= rainMultiplier;
  }

  // Wind resistance modifier
  if (weather === 'wind') {
    const windMultiplier = clamp(drone.windResistance / 50, 0.7, 1.3);
    score *= windMultiplier;
  }

  // Battery degradation over second half of the race
  if (segmentIndex >= totalSegments / 2) {
    const degradation = ((100 - drone.batteryCapacity) / 100) * 0.3;
    score *= 1 - degradation;
  }

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
 * @param {object} drone1
 * @param {object} drone2
 * @param {{ straights: number, turns: number, id?: string, name?: string }} track
 * @param {string} weather - 'clear'|'clouds'|'rain'|'heavy_rain'|'wind'|'haze'|'fog'
 * @param {string} timeOfDay - 'dawn'|'day'|'dusk'|'night'
 * @returns {{
 *   winnerId: string,
 *   drone1Time: number,
 *   drone2Time: number,
 *   raceLog: Array<{
 *     segment: number,
 *     type: 'straight'|'turn',
 *     drone1Score: number,
 *     drone2Score: number,
 *     drone1Time: number,
 *     drone2Time: number
 *   }>
 * }}
 */
export function simulateRace(drone1, drone2, track, weather, timeOfDay) {
  const segments = buildSegments(track);
  const total = segments.length;
  const log = [];
  let time1 = 0;
  let time2 = 0;

  for (let i = 0; i < total; i++) {
    const type = segments[i];
    const s1 = scoreSegment(drone1, type, i, total, weather, timeOfDay);
    const s2 = scoreSegment(drone2, type, i, total, weather, timeOfDay);
    const t1 = 100 / s1;
    const t2 = 100 / s2;
    time1 += t1;
    time2 += t2;
    log.push({
      segment: i + 1,
      type,
      drone1Score: Number(s1.toFixed(2)),
      drone2Score: Number(s2.toFixed(2)),
      drone1Time: Number(t1.toFixed(4)),
      drone2Time: Number(t2.toFixed(4)),
    });
  }

  const winnerId = time1 <= time2 ? drone1.id : drone2.id;
  return {
    winnerId,
    drone1Time: Number(time1.toFixed(4)),
    drone2Time: Number(time2.toFixed(4)),
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
