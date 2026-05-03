/**
 * Race Engine v2 full test against PROD database.
 *
 * READ-ONLY: only SELECT queries against PROD_DATABASE_URL. The race
 * simulation runs entirely in-memory; no race rows are written, no
 * drones / tracks are mutated. Every `await sql` call in this file
 * starts with `SELECT`.
 *
 * Two-pass: runs a 3-lap baseline pass and a 5-lap pass back-to-back so
 * the report can show side-by-side comparisons. The 5-lap pass produces
 * the full A-M analysis; the 3-lap pass is summarized for the comparison
 * table only. The simulator's hidden `__setForcedLaps` setter is the
 * test-only escape hatch that lets the harness toggle between 3 and 5
 * without re-importing.
 *
 * Usage:  node --env-file=.env.local scripts/test-engine-v2-full.js
 */

import { neon } from '@neondatabase/serverless';
import {
  simulateRace,
  randomWeather,
  randomTimeOfDay,
  __setForcedLaps,
} from '../lib/game-engine/race-simulator.js';

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) {
  console.error('PROD_DATABASE_URL not set in env. Aborting.');
  process.exit(1);
}
const sql = neon(PROD_URL);

const RACES_PER_BRACKET = 2500;
const TOTAL_RACES = RACES_PER_BRACKET * 4;

const BRACKETS = [
  { name: 'T1', minLvl: 1,  maxLvl: 5,  trackDiffMin: 1,  trackDiffMax: 3,  weight: 1.0 },
  { name: 'T2', minLvl: 6,  maxLvl: 10, trackDiffMin: 4,  trackDiffMax: 5,  weight: 1.5 },
  { name: 'T3', minLvl: 11, maxLvl: 15, trackDiffMin: 6,  trackDiffMax: 7,  weight: 2.0 },
  { name: 'T4', minLvl: 16, maxLvl: 20, trackDiffMin: 8,  trackDiffMax: 10, weight: 2.5 },
];

const SUBTYPE_NAMES = [
  'short_burst', 'standard_str', 'long_straight',
  'gentle_curve', 'standard_turn', 'sharp_hairpin', 'chicane',
];

function pad(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function padR(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }

const sum = (a, fn = (x) => x) => a.reduce((s, v) => s + fn(v), 0);
const avg = (a, fn = (x) => x) => (a.length ? sum(a, fn) / a.length : 0);
const stddev = (a) => {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(sum(a, (x) => (x - m) * (x - m)) / a.length);
};

function countLeadChangeIdxs(raceLog) {
  const idxs = [];
  let cum1 = 0, cum2 = 0;
  let prevSign = 0;
  for (let i = 0; i < raceLog.length; i++) {
    cum1 += raceLog[i].drone1Time;
    cum2 += raceLog[i].drone2Time;
    const diff = cum1 - cum2;
    const sign = diff > 0 ? -1 : diff < 0 ? 1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) idxs.push(i);
      prevSign = sign;
    }
  }
  return idxs;
}

function avgSegOnLap(raceLog, lap, droneIdx) {
  const segs = raceLog.filter((s) => s.lap === lap);
  if (segs.length === 0) return null;
  const key = droneIdx === 1 ? 'drone1Time' : 'drone2Time';
  return segs.reduce((acc, s) => acc + s[key], 0) / segs.length;
}

function relevantStat(weather, tod, drone) {
  if (weather === 'rain' || weather === 'heavy_rain') return drone.rainHandling;
  if (weather === 'wind') return drone.windResistance;
  if (weather === 'fog' || weather === 'haze') return drone.nightVision;
  if (tod === 'night') return drone.nightVision;
  return null;
}

// -------------------- load --------------------

console.log('Loading drones + tracks + race counts from PROD (read-only)...');

// READ-ONLY query
const droneRows = await sql`
  SELECT id, name, level, total_stat_budget, elo_rating,
    speed, turning, acceleration, durability,
    night_vision, battery_capacity, rain_handling, wind_resistance, consistency
  FROM drones
`;
// READ-ONLY query
const trackRows = await sql`
  SELECT id, name, difficulty, straights, turns, laps, length
  FROM tracks
`;
// READ-ONLY query — completed-race count per drone
const raceCountRows = await sql`
  SELECT drone_id, COUNT(*)::int AS race_count FROM (
    SELECT drone1_id AS drone_id FROM races WHERE status = 'completed'
    UNION ALL
    SELECT drone2_id FROM races WHERE status = 'completed'
  ) sub GROUP BY drone_id
`;

const raceCountByDrone = new Map(raceCountRows.map((r) => [r.drone_id, Number(r.race_count)]));

const drones = droneRows.map((r) => ({
  id: r.id,
  name: r.name,
  level: Number(r.level),
  tsb: Number(r.total_stat_budget),
  elo: Number(r.elo_rating),
  raceCount: raceCountByDrone.get(r.id) || 0,
  speed: Number(r.speed),
  turning: Number(r.turning),
  acceleration: Number(r.acceleration),
  durability: Number(r.durability),
  nightVision: Number(r.night_vision),
  batteryCapacity: Number(r.battery_capacity),
  rainHandling: Number(r.rain_handling),
  windResistance: Number(r.wind_resistance),
  consistency: Number(r.consistency),
}));

const tracks = trackRows.map((r) => ({
  id: r.id, name: r.name,
  difficulty: Number(r.difficulty),
  straights: Number(r.straights), turns: Number(r.turns),
  laps: Number(r.laps), length: r.length,
}));

console.log(`  loaded ${drones.length} drones, ${tracks.length} tracks, ${raceCountRows.length} drones with race history`);

// -------------------- bucket --------------------

const dronesByBracket = new Map();
const tracksByBracket = new Map();
for (const b of BRACKETS) {
  dronesByBracket.set(b.name, drones.filter((d) => d.level >= b.minLvl && d.level <= b.maxLvl));
  tracksByBracket.set(b.name, tracks.filter((t) => t.difficulty >= b.trackDiffMin && t.difficulty <= b.trackDiffMax));
}

console.log('\nBracket population:');
for (const b of BRACKETS) {
  const ds = dronesByBracket.get(b.name);
  const avgBat = ds.length ? ds.reduce((a, d) => a + d.batteryCapacity, 0) / ds.length : 0;
  console.log(
    `  ${b.name} drones=${ds.length} tracks=${tracksByBracket.get(b.name).length} ` +
      `(level ${b.minLvl}-${b.maxLvl}, diff ${b.trackDiffMin}-${b.trackDiffMax})  avg_battery=${avgBat.toFixed(1)}`,
  );
}

function pickPair(pool) {
  const i = Math.floor(Math.random() * pool.length);
  let j = Math.floor(Math.random() * pool.length);
  let tries = 0;
  while ((j === i || pool[i].id === pool[j].id) && tries < 50) {
    j = Math.floor(Math.random() * pool.length);
    tries += 1;
  }
  return [pool[i], pool[j]];
}

// -------------------- one full pass --------------------

function runPass(laps) {
  __setForcedLaps(laps);
  const startMs = Date.now();
  const races = [];
  for (const b of BRACKETS) {
    const pool = dronesByBracket.get(b.name);
    const trackPool = tracksByBracket.get(b.name);
    if (pool.length < 2 || trackPool.length === 0) {
      console.log(`  ${b.name}: insufficient pool, skipping`);
      continue;
    }
    for (let i = 0; i < RACES_PER_BRACKET; i++) {
      const [d1, d2] = pickPair(pool);
      const track = trackPool[Math.floor(Math.random() * trackPool.length)];
      const weather = randomWeather();
      const timeOfDay = randomTimeOfDay();
      const result = simulateRace(d1, d2, track, weather, timeOfDay);
      const margin = Math.abs(result.drone1Time - result.drone2Time);
      const winner = result.winnerId === d1.id ? d1 : d2;
      const loser = result.winnerId === d1.id ? d2 : d1;
      const leadChangeIdxs = countLeadChangeIdxs(result.raceLog);
      races.push({
        bracket: b.name, track, weather, timeOfDay,
        d1, d2, result, margin, winner, loser,
        leadChangeIdxs, leadChanges: leadChangeIdxs.length,
        upset: winner.tsb < loser.tsb,
      });
    }
  }
  const ms = Date.now() - startMs;
  return { laps, races, ms };
}

function summarize(pass) {
  const { races, laps } = pass;
  const margins = races.map((r) => r.margin);
  const lcs = races.map((r) => r.leadChanges);
  const photoFinish = races.filter((r) => r.margin < 0.1).length;
  const blowout = races.filter((r) => r.margin >= 5).length;
  const perBracket = {};
  for (const b of BRACKETS) {
    const sub = races.filter((r) => r.bracket === b.name);
    if (!sub.length) { perBracket[b.name] = null; continue; }
    const m = sub.map((r) => r.margin);
    const lc = sub.map((r) => r.leadChanges);
    let l1 = 0, lN = 0, c = 0;
    for (const r of sub) {
      for (const di of [1, 2]) {
        const a1 = avgSegOnLap(r.result.raceLog, 1, di);
        const aN = avgSegOnLap(r.result.raceLog, laps, di);
        if (a1 !== null && aN !== null) { l1 += a1; lN += aN; c++; }
      }
    }
    const fadePct = c ? (((lN / c) - (l1 / c)) / (l1 / c)) * 100 : 0;
    const tsbDiff = sub.filter((r) => r.winner.tsb !== r.loser.tsb);
    const upsets = tsbDiff.filter((r) => r.upset).length;
    perBracket[b.name] = {
      n: sub.length,
      avgMargin: avg(m),
      avgLc: avg(lc),
      lcAtLeast1Pct: (sub.filter((r) => r.leadChanges >= 1).length / sub.length) * 100,
      fadePct,
      avgTime: avg(sub.map((r) => r.result.drone1Time)),
      upsetPct: tsbDiff.length ? (100 * upsets) / tsbDiff.length : 0,
    };
  }
  const byDiff = new Map();
  for (const r of races) {
    const arr = byDiff.get(r.track.difficulty) || [];
    arr.push(r.result.drone1Time);
    byDiff.set(r.track.difficulty, arr);
  }
  const timeByDiff = {};
  for (const [d, arr] of byDiff.entries()) timeByDiff[d] = avg(arr);
  return {
    laps,
    n: races.length,
    avgMargin: avg(margins),
    avgLc: avg(lcs),
    photoFinishPct: (100 * photoFinish) / races.length,
    blowoutPct: (100 * blowout) / races.length,
    perBracket,
    timeByDiff,
  };
}

// -------------------- run baseline (3 laps) + main (5 laps) --------------------

console.log(`\nRunning baseline pass (3 laps, ${TOTAL_RACES} races)...`);
const baselinePass = runPass(3);
console.log(`  done in ${(baselinePass.ms / 1000).toFixed(1)}s.`);
const baseline = summarize(baselinePass);

console.log(`\nRunning main pass (5 laps, ${TOTAL_RACES} races)...`);
const mainPass = runPass(5);
console.log(`  done in ${(mainPass.ms / 1000).toFixed(1)}s.`);
const main = summarize(mainPass);

const races = mainPass.races; // alias used by sections A-M
const totalLaps = mainPass.laps;

// -------------------- A. overall margin distribution --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('A. OVERALL MARGIN DISTRIBUTION (5 laps)');
console.log('='.repeat(76));

const buckets = [
  ['0.000-0.100s', (m) => m < 0.1],
  ['0.100-0.500s', (m) => m >= 0.1 && m < 0.5],
  ['0.500-1.000s', (m) => m >= 0.5 && m < 1.0],
  ['1.000-2.000s', (m) => m >= 1.0 && m < 2.0],
  ['2.000-5.000s', (m) => m >= 2.0 && m < 5.0],
  ['5.000-10.00s', (m) => m >= 5.0 && m < 10.0],
  ['10.00s+     ', (m) => m >= 10.0],
];
for (const [label, test] of buckets) {
  const c = races.filter((r) => test(r.margin)).length;
  const pct = ((100 * c) / races.length).toFixed(1).padStart(5);
  const bar = '█'.repeat(Math.round(c / 50));
  console.log(`  ${label}  ${padR(c, 5)}  ${pct}%  ${bar}`);
}
const margins = races.map((r) => r.margin).sort((a, b) => a - b);
console.log(
  `  avg=${avg(margins).toFixed(3)}s  median=${margins[Math.floor(margins.length / 2)].toFixed(3)}s` +
    `  min=${margins[0].toFixed(4)}s  max=${margins[margins.length - 1].toFixed(2)}s  stddev=${stddev(margins).toFixed(3)}s`,
);
console.log(
  `  vs 3-lap baseline: avg ${baseline.avgMargin.toFixed(3)}s → ${main.avgMargin.toFixed(3)}s ` +
    `(${main.avgMargin >= baseline.avgMargin ? '+' : ''}${(main.avgMargin - baseline.avgMargin).toFixed(3)}s)`,
);

// -------------------- B. per-bracket margin distribution --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('B. PER-BRACKET MARGIN DISTRIBUTION (5 laps)');
console.log('='.repeat(76));

console.log(
  `  ${pad('br', 4)} ${pad('n', 5)} ${pad('avg', 7)} ${pad('median', 7)} ${pad('max', 7)}` +
    `  <0.1   <0.5   <1     <2     <5     ≥5`,
);
for (const b of BRACKETS) {
  const sub = races.filter((r) => r.bracket === b.name);
  if (!sub.length) continue;
  const subM = sub.map((r) => r.margin).sort((a, c) => a - c);
  const med = subM[Math.floor(subM.length / 2)];
  const pct = (test) => ((100 * sub.filter((r) => test(r.margin)).length) / sub.length).toFixed(1).padStart(5);
  console.log(
    `  ${pad(b.name, 4)} ${padR(sub.length, 5)} ${padR(avg(subM).toFixed(3), 7)} ${padR(med.toFixed(3), 7)} ${padR(subM[subM.length - 1].toFixed(2), 7)}` +
      `  ${pct((m) => m < 0.1)}% ${pct((m) => m < 0.5)}% ${pct((m) => m < 1)}% ${pct((m) => m < 2)}% ${pct((m) => m < 5)}% ${pct((m) => m >= 5)}%`,
  );
}

// -------------------- C. per-track --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('C. PER-TRACK ANALYSIS (5 laps)');
console.log('='.repeat(76));

console.log(
  `  ${pad('track', 18)} ${pad('diff', 4)} ${pad('S/T', 5)} ${pad('len', 7)} ${pad('races', 5)} ${pad('avg_marg', 8)} ${pad('avg_time', 9)} ${pad('min_m', 7)} ${pad('max_m', 7)} ${pad('avg_lc', 6)}`,
);
const trackOrdered = [...tracks].sort((a, b) => a.difficulty - b.difficulty);
for (const t of trackOrdered) {
  const sub = races.filter((r) => r.track.id === t.id);
  if (!sub.length) continue;
  const subM = sub.map((r) => r.margin);
  const subT = sub.map((r) => r.result.drone1Time);
  const subLc = sub.map((r) => r.leadChanges);
  console.log(
    `  ${pad(t.name, 18)} ${padR(t.difficulty, 4)} ${pad(`${t.straights}/${t.turns}`, 5)} ${pad(t.length, 7)} ${padR(sub.length, 5)}` +
      ` ${padR(avg(subM).toFixed(3), 8)} ${padR(avg(subT).toFixed(2), 9)} ${padR(Math.min(...subM).toFixed(4), 7)} ${padR(Math.max(...subM).toFixed(2), 7)} ${padR(avg(subLc).toFixed(2), 6)}`,
  );
}

// -------------------- D. lead changes --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('D. LEAD CHANGES (5 laps)');
console.log('='.repeat(76));

const allLcs = races.map((r) => r.leadChanges);
console.log(`  Overall: avg=${avg(allLcs).toFixed(2)}  min=${Math.min(...allLcs)}  max=${Math.max(...allLcs)}`);
const lcDist = {};
for (const c of allLcs) {
  const k = c >= 5 ? '5+' : String(c);
  lcDist[k] = (lcDist[k] || 0) + 1;
}
for (const k of ['0', '1', '2', '3', '4', '5+']) {
  const v = lcDist[k] || 0;
  const pct = ((100 * v) / races.length).toFixed(1).padStart(5);
  console.log(`    ${pad(k, 3)} changes: ${padR(v, 5)}  ${pct}%  ${'█'.repeat(Math.round(v / 50))}`);
}
console.log('\n  By bracket:');
for (const b of BRACKETS) {
  const sub = races.filter((r) => r.bracket === b.name);
  if (!sub.length) continue;
  const lcs = sub.map((r) => r.leadChanges);
  const ge1 = sub.filter((r) => r.leadChanges >= 1).length;
  const ge2 = sub.filter((r) => r.leadChanges >= 2).length;
  console.log(
    `    ${b.name}: avg=${avg(lcs).toFixed(2)}  max=${Math.max(...lcs)}  ` +
      `≥1=${ge1} (${((100 * ge1) / sub.length).toFixed(1)}%)  ≥2=${ge2} (${((100 * ge2) / sub.length).toFixed(1)}%)`,
  );
}

console.log('\n  Lead-change events by lap:');
const eventsByLap = {};
for (let l = 1; l <= totalLaps; l++) eventsByLap[l] = 0;
let totalEvents = 0;
for (const r of races) {
  for (const idx of r.leadChangeIdxs) {
    const lap = r.result.raceLog[idx]?.lap || 1;
    eventsByLap[lap] = (eventsByLap[lap] || 0) + 1;
    totalEvents += 1;
  }
}
for (const [lap, count] of Object.entries(eventsByLap)) {
  const pct = totalEvents > 0 ? ((100 * count) / totalEvents).toFixed(1) : '0.0';
  console.log(`    lap ${lap}: ${padR(count, 5)} events (${pct}% of all events)`);
}
console.log(`    total events: ${totalEvents}`);

// -------------------- E. battery fade --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('E. BATTERY FADE (per-bracket lap-by-lap, 5 laps)');
console.log('='.repeat(76));

let header = `  ${pad('br', 4)} ${pad('avg_bat', 7)}`;
for (let l = 1; l <= totalLaps; l++) header += ` ${pad(`lap${l}`, 9)}`;
header += ` ${pad('fade(L1→L5)', 12)}`;
console.log(header);
for (const b of BRACKETS) {
  const sub = races.filter((r) => r.bracket === b.name);
  if (!sub.length) continue;
  const lapSums = new Array(totalLaps + 1).fill(0);
  let c = 0;
  let totalBat = 0, batCount = 0;
  for (const r of sub) {
    for (const di of [1, 2]) {
      const lapAvgs = [];
      for (let l = 1; l <= totalLaps; l++) lapAvgs.push(avgSegOnLap(r.result.raceLog, l, di));
      if (lapAvgs.every((v) => v !== null)) {
        for (let l = 1; l <= totalLaps; l++) lapSums[l] += lapAvgs[l - 1];
        c++;
      }
      totalBat += (di === 1 ? r.d1.batteryCapacity : r.d2.batteryCapacity);
      batCount += 1;
    }
  }
  let row = `  ${pad(b.name, 4)} ${padR((totalBat / batCount).toFixed(1), 7)}`;
  const lapAvgs = [];
  for (let l = 1; l <= totalLaps; l++) {
    const v = c ? lapSums[l] / c : 0;
    lapAvgs.push(v);
    row += ` ${padR(v.toFixed(4) + 's', 9)}`;
  }
  const fadePct = lapAvgs[0] > 0 ? ((lapAvgs[totalLaps - 1] - lapAvgs[0]) / lapAvgs[0]) * 100 : 0;
  row += ` ${padR((fadePct >= 0 ? '+' : '') + fadePct.toFixed(2) + '%', 12)}`;
  console.log(row);
}

// Final-lap lead changes from fade
let batteryLeadChanges = 0;
const batteryFadeRaces = [];
for (const r of races) {
  const finalLap = totalLaps;
  const finalLapEvents = r.leadChangeIdxs.filter((idx) => r.result.raceLog[idx]?.lap === finalLap);
  if (!finalLapEvents.length) continue;
  const loserKey = r.winner.id === r.d1.id ? 'drone2Time' : 'drone1Time';
  const lap1 = r.result.raceLog.filter((s) => s.lap === 1);
  const lapF = r.result.raceLog.filter((s) => s.lap === finalLap);
  if (!lap1.length || !lapF.length) continue;
  const a1 = lap1.reduce((a, s) => a + s[loserKey], 0) / lap1.length;
  const aF = lapF.reduce((a, s) => a + s[loserKey], 0) / lapF.length;
  if (a1 > 0 && (aF - a1) / a1 > 0.05) {
    batteryLeadChanges += 1;
    batteryFadeRaces.push(r);
  }
}
console.log(
  `\n  Final-lap lead changes with loser >5% slower vs lap 1: ${batteryLeadChanges} ` +
    `(${((100 * batteryLeadChanges) / races.length).toFixed(1)}% of all races)`,
);

// Low-battery vs high-battery split per bracket — fade compared on L1 → L5
console.log('\n  Low-battery (bottom 25%) vs high-battery (top 25%) per bracket:');
console.log(`    ${pad('br', 4)} ${pad('low_q25', 8)} ${pad('hi_q75', 8)} ${pad('low_fade', 9)} ${pad('hi_fade', 9)} ${pad('low/hi long_wr', 18)} ${pad('low/hi short_wr', 18)}`);
for (const b of BRACKETS) {
  const ds = dronesByBracket.get(b.name);
  if (!ds.length) continue;
  const bats = ds.map((d) => d.batteryCapacity).sort((a, c) => a - c);
  const q25 = bats[Math.floor(bats.length * 0.25)];
  const q75 = bats[Math.floor(bats.length * 0.75)];
  const lowSet = new Set(ds.filter((d) => d.batteryCapacity <= q25).map((d) => d.id));
  const hiSet = new Set(ds.filter((d) => d.batteryCapacity >= q75).map((d) => d.id));
  const sub = races.filter((r) => r.bracket === b.name);

  const fade = (set) => {
    let l1 = 0, lN = 0, c = 0;
    for (const r of sub) {
      for (const di of [1, 2]) {
        const drone = di === 1 ? r.d1 : r.d2;
        if (!set.has(drone.id)) continue;
        const a1 = avgSegOnLap(r.result.raceLog, 1, di);
        const aN = avgSegOnLap(r.result.raceLog, totalLaps, di);
        if (a1 !== null && aN !== null) { l1 += a1; lN += aN; c++; }
      }
    }
    return c ? (((lN / c) - (l1 / c)) / (l1 / c)) * 100 : null;
  };

  const headToHead = (lengthFilter) => {
    let lowWins = 0, hiWins = 0;
    for (const r of sub) {
      if (r.track.length !== lengthFilter) continue;
      const d1Low = lowSet.has(r.d1.id), d2Low = lowSet.has(r.d2.id);
      const d1Hi = hiSet.has(r.d1.id), d2Hi = hiSet.has(r.d2.id);
      if (d1Low && d2Hi) {
        if (r.winner.id === r.d1.id) lowWins++; else hiWins++;
      } else if (d2Low && d1Hi) {
        if (r.winner.id === r.d2.id) lowWins++; else hiWins++;
      }
    }
    const total = lowWins + hiWins;
    return total > 0
      ? `${((100 * lowWins) / total).toFixed(0)}/${((100 * hiWins) / total).toFixed(0)}% (n=${total})`
      : 'n/a';
  };

  const lowFade = fade(lowSet);
  const hiFade = fade(hiSet);
  console.log(
    `    ${pad(b.name, 4)} ${padR(q25, 8)} ${padR(q75, 8)} ` +
      `${padR(lowFade !== null ? (lowFade >= 0 ? '+' : '') + lowFade.toFixed(2) + '%' : 'n/a', 9)} ` +
      `${padR(hiFade !== null ? (hiFade >= 0 ? '+' : '') + hiFade.toFixed(2) + '%' : 'n/a', 9)} ` +
      `${pad(headToHead('long'), 18)} ${pad(headToHead('short'), 18)}`,
  );
}
console.log('  (long_wr/short_wr show LOW%/HIGH% on long vs short tracks; comparison is direct paired matchups only)');

// -------------------- F. weather impact --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('F. WEATHER IMPACT (5 laps)');
console.log('='.repeat(76));

console.log('  By weather:');
for (const w of ['clear', 'clouds', 'rain', 'heavy_rain', 'wind', 'haze', 'fog']) {
  const sub = races.filter((r) => r.weather === w);
  if (!sub.length) continue;
  console.log(`    ${pad(w, 11)} n=${padR(sub.length, 5)}  avg_margin=${avg(sub.map((r) => r.margin)).toFixed(3)}s`);
}
console.log('  By time of day:');
for (const tod of ['dawn', 'day', 'dusk', 'night']) {
  const sub = races.filter((r) => r.timeOfDay === tod);
  if (!sub.length) continue;
  console.log(`    ${pad(tod, 6)} n=${padR(sub.length, 5)}  avg_margin=${avg(sub.map((r) => r.margin)).toFixed(3)}s`);
}

const cd = races.filter((r) => r.weather === 'clear' && r.timeOfDay === 'day');
const hrn = races.filter((r) => r.weather === 'heavy_rain' && r.timeOfDay === 'night');
const fn = races.filter((r) => r.weather === 'fog' && r.timeOfDay === 'night');
const fmtBucket = (g, label) => {
  if (!g.length) return `    ${pad(label, 22)} (no samples)`;
  return `    ${pad(label, 22)} n=${padR(g.length, 4)}  avg_margin=${avg(g.map((r) => r.margin)).toFixed(3)}s  avg_time=${avg(g.map((r) => r.result.drone1Time)).toFixed(2)}s`;
};
console.log('  Combined extremes:');
console.log(fmtBucket(cd, 'clear/day'));
console.log(fmtBucket(hrn, 'heavy_rain/night'));
console.log(fmtBucket(fn, 'fog/night'));

let disLost = 0, disWon = 0, applicable = 0;
for (const r of races) {
  const s1 = relevantStat(r.weather, r.timeOfDay, r.d1);
  const s2 = relevantStat(r.weather, r.timeOfDay, r.d2);
  if (s1 === null || s2 === null || s1 === s2) continue;
  applicable += 1;
  const disDrone = s1 < s2 ? r.d1 : r.d2;
  if (r.winner.id === disDrone.id) disWon += 1;
  else disLost += 1;
}
console.log(
  `  Weather-disadvantaged drone — applicable=${applicable}  lost=${disLost} (${((100 * disLost) / Math.max(1, applicable)).toFixed(1)}%)  won=${disWon} (${((100 * disWon) / Math.max(1, applicable)).toFixed(1)}%)`,
);

// -------------------- G. upset rate --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('G. UPSET RATE (lower-TSB wins, per bracket, 5 laps)');
console.log('='.repeat(76));

for (const b of BRACKETS) {
  const sub = races.filter((r) => r.bracket === b.name);
  if (!sub.length) continue;
  const tsbDiff = sub.filter((r) => r.winner.tsb !== r.loser.tsb);
  const upsets = tsbDiff.filter((r) => r.upset).length;
  const upsetPct = tsbDiff.length > 0 ? ((100 * upsets) / tsbDiff.length).toFixed(1) : '-';
  console.log(`    ${b.name}: races=${sub.length}  tsb-different=${tsbDiff.length}  upsets=${upsets}  upset_pct=${upsetPct}%`);
}

// -------------------- H. segment subtype analysis --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('H. SEGMENT SUBTYPE ANALYSIS (5 laps)');
console.log('='.repeat(76));

const subtypeStats = new Map();
for (const name of SUBTYPE_NAMES) {
  subtypeStats.set(name, { n: 0, timeSum: 0, gapSum: 0, leadChanges: 0, maxGap: 0 });
}
for (const r of races) {
  let cum1 = 0, cum2 = 0;
  let prevSign = 0;
  for (let i = 0; i < r.result.raceLog.length; i++) {
    const seg = r.result.raceLog[i];
    const st = subtypeStats.get(seg.subtype);
    if (!st) continue;
    st.n += 2;
    st.timeSum += seg.drone1Time + seg.drone2Time;
    const segGap = Math.abs(seg.drone1Time - seg.drone2Time);
    st.gapSum += segGap;
    if (segGap > st.maxGap) st.maxGap = segGap;

    cum1 += seg.drone1Time;
    cum2 += seg.drone2Time;
    const diff = cum1 - cum2;
    const sign = diff > 0 ? -1 : diff < 0 ? 1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) st.leadChanges += 1;
      prevSign = sign;
    }
  }
}

console.log(`  ${pad('subtype', 16)} ${pad('n_seg', 7)} ${pad('avg_time', 9)} ${pad('avg_gap', 9)} ${pad('max_gap', 9)} ${pad('lead_chgs', 9)}`);
const subtypeRows = [];
for (const name of SUBTYPE_NAMES) {
  const s = subtypeStats.get(name);
  if (s.n === 0) continue;
  subtypeRows.push({
    name,
    avgTime: s.timeSum / s.n,
    avgGap: s.gapSum / (s.n / 2),
    maxGap: s.maxGap,
    leadChgs: s.leadChanges,
    n: s.n,
  });
  console.log(
    `  ${pad(name, 16)} ${padR(s.n, 7)} ${padR((s.timeSum / s.n).toFixed(4) + 's', 9)} ${padR((s.gapSum / (s.n / 2)).toFixed(4) + 's', 9)} ${padR(s.maxGap.toFixed(3) + 's', 9)} ${padR(s.leadChanges, 9)}`,
  );
}
const mostLcSubtype = subtypeRows.slice().sort((a, b) => b.leadChgs - a.leadChgs)[0];
const widestGapSubtype = subtypeRows.slice().sort((a, b) => b.avgGap - a.avgGap)[0];
console.log(`  → most per-segment lead changes: ${mostLcSubtype?.name} (${mostLcSubtype?.leadChgs})`);
console.log(`  → widest avg per-segment time gap: ${widestGapSubtype?.name} (${widestGapSubtype?.avgGap.toFixed(4)}s)`);

// -------------------- I. segment time variety --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('I. SEGMENT TIME VARIETY (5 laps)');
console.log('='.repeat(76));

let strSum = 0, strCnt = 0, turnSum = 0, turnCnt = 0;
let adjSameTypeSum = 0, adjSameTypeCnt = 0;
let adjSameSubtypeSum = 0, adjSameSubtypeCnt = 0;
for (const r of races) {
  for (let i = 0; i < r.result.raceLog.length; i++) {
    const seg = r.result.raceLog[i];
    if (seg.type === 'straight') { strSum += seg.drone1Time + seg.drone2Time; strCnt += 2; }
    else { turnSum += seg.drone1Time + seg.drone2Time; turnCnt += 2; }
    if (i > 0) {
      const prev = r.result.raceLog[i - 1];
      if (prev.lap === seg.lap && prev.type === seg.type) {
        adjSameTypeSum += Math.abs(seg.drone1Time - prev.drone1Time) + Math.abs(seg.drone2Time - prev.drone2Time);
        adjSameTypeCnt += 2;
        if (prev.subtype === seg.subtype) {
          adjSameSubtypeSum += Math.abs(seg.drone1Time - prev.drone1Time) + Math.abs(seg.drone2Time - prev.drone2Time);
          adjSameSubtypeCnt += 2;
        }
      }
    }
  }
}
const avgStr = strSum / strCnt, avgTurn = turnSum / turnCnt;
console.log(`  Avg straight segment time: ${avgStr.toFixed(4)}s  (n=${strCnt})`);
console.log(`  Avg turn segment time:     ${avgTurn.toFixed(4)}s  (n=${turnCnt})`);
console.log(`  Turn / straight ratio: ${(avgTurn / avgStr).toFixed(2)}×`);
console.log(`  Adjacent same-type    |delta|: avg=${(adjSameTypeSum / adjSameTypeCnt).toFixed(4)}s  (n=${adjSameTypeCnt})`);
console.log(`  Adjacent same-subtype |delta|: avg=${(adjSameSubtypeSum / adjSameSubtypeCnt).toFixed(4)}s  (n=${adjSameSubtypeCnt})  ← jitter only`);

// -------------------- J. race time by difficulty --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('J. RACE TIME BY TRACK DIFFICULTY (5 laps)');
console.log('='.repeat(76));

const byDiff = new Map();
for (const r of races) {
  const arr = byDiff.get(r.track.difficulty) || [];
  arr.push(r.result.drone1Time);
  byDiff.set(r.track.difficulty, arr);
}
const diffs = [...byDiff.keys()].sort((a, b) => a - b);
console.log(`  ${pad('diff', 5)} ${pad('races', 6)} ${pad('avg_time', 9)} ${pad('min', 8)} ${pad('max', 8)} ${pad('vs_3lap', 10)}`);
for (const d of diffs) {
  const arr = byDiff.get(d).sort((a, b) => a - b);
  const baseTime = baseline.timeByDiff[d];
  const baseStr = baseTime ? `${baseTime.toFixed(2)}s→${avg(arr).toFixed(2)}s` : 'n/a';
  console.log(`  ${padR(d, 5)} ${padR(arr.length, 6)} ${padR(avg(arr).toFixed(2) + 's', 9)} ${padR(arr[0].toFixed(2) + 's', 8)} ${padR(arr[arr.length - 1].toFixed(2) + 's', 8)} ${padR(baseStr, 10)}`);
}

// -------------------- K. ELO accuracy --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('K. ELO PREDICTIVE ACCURACY (drones with >10 completed prod races, 5 laps)');
console.log('='.repeat(76));

console.log(`  ${pad('br', 4)} ${pad('eligible', 9)} ${pad('higher-elo wins', 16)}`);
for (const b of BRACKETS) {
  const sub = races.filter(
    (r) => r.bracket === b.name && r.d1.raceCount > 10 && r.d2.raceCount > 10 && r.d1.elo !== r.d2.elo,
  );
  if (!sub.length) {
    console.log(`  ${pad(b.name, 4)} ${padR(0, 9)} (no eligible matchups)`);
    continue;
  }
  let hi = 0;
  for (const r of sub) {
    const hiDrone = r.d1.elo > r.d2.elo ? r.d1 : r.d2;
    if (r.winner.id === hiDrone.id) hi += 1;
  }
  const pct = ((100 * hi) / sub.length).toFixed(1);
  console.log(`  ${pad(b.name, 4)} ${padR(sub.length, 9)} ${padR(`${hi} (${pct}%)`, 16)}`);
}

// -------------------- L. synopsis (5 races) --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('L. SYNOPSIS GENERATION (5 representative races, 5 laps)');
console.log('='.repeat(76));

function generateSynopsis(race) {
  const log = race.result.raceLog;
  const winnerIsDrone1 = race.winner.id === race.d1.id;
  const winnerName = race.winner.name;
  const loserName = race.loser.name;
  const weather = race.weather;
  const timeOfDay = race.timeOfDay;
  const gaps = [];
  let cumW = 0, cumL = 0;
  for (const s of log) {
    cumW += winnerIsDrone1 ? s.drone1Time : s.drone2Time;
    cumL += winnerIsDrone1 ? s.drone2Time : s.drone1Time;
    gaps.push(cumL - cumW);
  }
  const lcIdxs = [];
  let prevSign = 0;
  for (let i = 0; i < gaps.length; i++) {
    const sign = gaps[i] > 0 ? 1 : gaps[i] < 0 ? -1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) lcIdxs.push(i);
      prevSign = sign;
    }
  }
  let base;
  if (lcIdxs.length === 0) {
    base = `${winnerName} dominated wire to wire, leading every segment`;
  } else if (lcIdxs.length === 1) {
    const lap = log[lcIdxs[0]]?.lap ?? '-';
    base = `${winnerName} overtook ${loserName} on lap ${lap} and held on`;
  } else {
    const lastIdx = lcIdxs[lcIdxs.length - 1];
    const lap = log[lastIdx]?.lap ?? '-';
    let segInLap = 0;
    for (let i = 0; i <= lastIdx; i++) if (log[i]?.lap === log[lastIdx]?.lap) segInLap += 1;
    base = `Back-and-forth battle — ${winnerName} took the lead for the final time on lap ${lap}, segment ${segInLap}`;
  }
  const conds = [];
  if (weather === 'rain') conds.push('in rain');
  else if (weather === 'heavy_rain') conds.push('in heavy rain');
  else if (weather === 'wind') conds.push('in windy conditions');
  else if (weather === 'fog') conds.push('in fog');
  else if (weather === 'haze') conds.push('in hazy conditions');
  if (timeOfDay === 'night') conds.push('under night conditions');
  else if (timeOfDay === 'dawn') conds.push('at dawn');
  else if (timeOfDay === 'dusk') conds.push('at dusk');
  let res = conds.length ? `${base} ${conds.join(' ')}.` : `${base}.`;
  const totalLapsLog = log.reduce((m, s) => Math.max(m, s.lap || 1), 1);
  if (totalLapsLog >= 3) {
    const loserKey = winnerIsDrone1 ? 'drone2Time' : 'drone1Time';
    const lap1 = log.filter((s) => s.lap === 1);
    const lapL = log.filter((s) => s.lap === totalLapsLog);
    if (lap1.length && lapL.length) {
      const a1 = lap1.reduce((a, s) => a + s[loserKey], 0) / lap1.length;
      const aL = lapL.reduce((a, s) => a + s[loserKey], 0) / lapL.length;
      if (a1 > 0 && (aL - a1) / a1 > 0.03) res += ` ${loserName} faded in the final lap.`;
    }
  }
  return res;
}

const sortedByMargin = [...races].sort((a, b) => a.margin - b.margin);
const sortedByLcs = [...races].sort((a, b) => b.leadChanges - a.leadChanges);

const weatherDominated = races
  .filter((r) => {
    if (!['heavy_rain', 'fog'].includes(r.weather)) return false;
    const s1 = relevantStat(r.weather, r.timeOfDay, r.d1);
    const s2 = relevantStat(r.weather, r.timeOfDay, r.d2);
    if (s1 === null || s2 === null || s1 === s2) return false;
    const dis = s1 < s2 ? r.d1 : r.d2;
    return r.winner.id !== dis.id;
  })
  .sort((a, b) => b.margin - a.margin)[0];

const samples = [
  { label: 'CLOSEST', race: sortedByMargin[0] },
  { label: 'BIGGEST BLOWOUT', race: sortedByMargin[sortedByMargin.length - 1] },
  { label: 'MOST LEAD CHANGES', race: sortedByLcs[0] },
  { label: 'WEATHER-DOMINATED', race: weatherDominated },
  { label: 'BATTERY-FADE-DECIDED', race: batteryFadeRaces[0] },
];

for (const s of samples) {
  if (!s.race) {
    console.log(`\n--- ${s.label} ---  (no qualifying race found)`);
    continue;
  }
  const r = s.race;
  console.log(`\n--- ${s.label} ---`);
  console.log(
    `  ${r.bracket}  ${r.track.name} (diff ${r.track.difficulty}, ${r.track.straights}S/${r.track.turns}T, ${r.track.length})  weather=${r.weather}/${r.timeOfDay}`,
  );
  console.log(
    `  d1 ${r.d1.name} L${r.d1.level} TSB ${r.d1.tsb} bat ${r.d1.batteryCapacity}` +
      `  d2 ${r.d2.name} L${r.d2.level} TSB ${r.d2.tsb} bat ${r.d2.batteryCapacity}`,
  );
  console.log(
    `  total: d1=${r.result.drone1Time.toFixed(4)}s  d2=${r.result.drone2Time.toFixed(4)}s  margin=${r.margin.toFixed(4)}s  winner=${r.winner.name}  lead_changes=${r.leadChanges}`,
  );
  console.log(`  SYNOPSIS: ${generateSynopsis(r)}`);
}

// -------------------- M. 3 full race logs --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('M. FULL RACE LOGS (close, blowout, ≥3 lead changes, 5 laps)');
console.log('='.repeat(76));

const closeR = sortedByMargin[0];
const blowoutR = sortedByMargin[sortedByMargin.length - 1];
const lcRace = races.filter((r) => r.leadChanges >= 3).sort((a, b) => b.leadChanges - a.leadChanges)[0] ?? sortedByLcs[0];

for (const [label, r] of [['CLOSE', closeR], ['BLOWOUT', blowoutR], ['MULTI-LEAD-CHANGE', lcRace]]) {
  if (!r) continue;
  console.log(`\n--- ${label}: ${r.track.name} (diff ${r.track.difficulty}, ${r.weather}/${r.timeOfDay}) ---`);
  console.log(`  ${r.d1.name} L${r.d1.level} TSB ${r.d1.tsb} vs ${r.d2.name} L${r.d2.level} TSB ${r.d2.tsb}`);
  console.log(`  margin=${r.margin.toFixed(4)}s  winner=${r.winner.name}  lead_changes=${r.leadChanges}`);
  console.log('  seg lap type     subtype          d1_time  d2_time  cum_gap (d1-d2)');
  let c1 = 0, c2 = 0;
  for (const seg of r.result.raceLog) {
    c1 += seg.drone1Time;
    c2 += seg.drone2Time;
    const gap = c1 - c2;
    console.log(
      `  ${padR(seg.segment, 3)} ${padR(seg.lap, 3)} ${pad(seg.type, 8)} ${pad(seg.subtype, 16)} ${seg.drone1Time.toFixed(4)}  ${seg.drone2Time.toFixed(4)}  ${(gap >= 0 ? '+' : '') + gap.toFixed(4)}`,
    );
  }
}

// -------------------- N. 3 vs 5 lap comparison --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('N. 3-LAP vs 5-LAP SIDE-BY-SIDE COMPARISON');
console.log('='.repeat(76));

const arrow = (a, b, dp = 3, suffix = '') => `${a.toFixed(dp)}${suffix}→${b.toFixed(dp)}${suffix}`;
const delta = (a, b, dp = 3) => `${(b - a >= 0 ? '+' : '')}${(b - a).toFixed(dp)}`;

console.log('\n  Avg margin per bracket:');
console.log(`    ${pad('br', 4)} ${pad('3-lap', 9)} ${pad('5-lap', 9)} ${pad('delta', 9)}`);
for (const b of BRACKETS) {
  const a3 = baseline.perBracket[b.name];
  const a5 = main.perBracket[b.name];
  if (!a3 || !a5) continue;
  console.log(`    ${pad(b.name, 4)} ${padR(a3.avgMargin.toFixed(3) + 's', 9)} ${padR(a5.avgMargin.toFixed(3) + 's', 9)} ${padR(delta(a3.avgMargin, a5.avgMargin), 9)}`);
}

console.log('\n  Lead-change rate per bracket (avg lead changes per race):');
console.log(`    ${pad('br', 4)} ${pad('3-lap', 9)} ${pad('5-lap', 9)} ${pad('delta', 9)} ${pad('3-lap≥1', 9)} ${pad('5-lap≥1', 9)}`);
for (const b of BRACKETS) {
  const a3 = baseline.perBracket[b.name];
  const a5 = main.perBracket[b.name];
  if (!a3 || !a5) continue;
  console.log(`    ${pad(b.name, 4)} ${padR(a3.avgLc.toFixed(2), 9)} ${padR(a5.avgLc.toFixed(2), 9)} ${padR(delta(a3.avgLc, a5.avgLc, 2), 9)} ${padR(a3.lcAtLeast1Pct.toFixed(1) + '%', 9)} ${padR(a5.lcAtLeast1Pct.toFixed(1) + '%', 9)}`);
}

console.log('\n  Battery fade per bracket (lap1 → final-lap segment time delta):');
console.log(`    ${pad('br', 4)} ${pad('3-lap fade', 11)} ${pad('5-lap fade', 11)} ${pad('delta', 9)}`);
for (const b of BRACKETS) {
  const a3 = baseline.perBracket[b.name];
  const a5 = main.perBracket[b.name];
  if (!a3 || !a5) continue;
  console.log(`    ${pad(b.name, 4)} ${padR((a3.fadePct >= 0 ? '+' : '') + a3.fadePct.toFixed(2) + '%', 11)} ${padR((a5.fadePct >= 0 ? '+' : '') + a5.fadePct.toFixed(2) + '%', 11)} ${padR(delta(a3.fadePct, a5.fadePct, 2) + 'pp', 9)}`);
}

console.log('\n  Upset rate per bracket:');
console.log(`    ${pad('br', 4)} ${pad('3-lap', 9)} ${pad('5-lap', 9)} ${pad('delta', 9)}`);
for (const b of BRACKETS) {
  const a3 = baseline.perBracket[b.name];
  const a5 = main.perBracket[b.name];
  if (!a3 || !a5) continue;
  console.log(`    ${pad(b.name, 4)} ${padR(a3.upsetPct.toFixed(1) + '%', 9)} ${padR(a5.upsetPct.toFixed(1) + '%', 9)} ${padR(delta(a3.upsetPct, a5.upsetPct, 1) + 'pp', 9)}`);
}

console.log('\n  Avg race time per difficulty:');
console.log(`    ${pad('diff', 5)} ${pad('3-lap', 9)} ${pad('5-lap', 9)} ${pad('delta', 9)} ${pad('ratio', 6)}`);
const allDiffs = [...new Set([...Object.keys(baseline.timeByDiff), ...Object.keys(main.timeByDiff)])]
  .map(Number).sort((a, b) => a - b);
for (const d of allDiffs) {
  const t3 = baseline.timeByDiff[d];
  const t5 = main.timeByDiff[d];
  if (t3 == null || t5 == null) continue;
  console.log(`    ${padR(d, 5)} ${padR(t3.toFixed(2) + 's', 9)} ${padR(t5.toFixed(2) + 's', 9)} ${padR(delta(t3, t5, 2) + 's', 9)} ${padR((t5 / t3).toFixed(2) + '×', 6)}`);
}

console.log('\n  Photo-finish rate (overall, margin <0.1s):');
console.log(`    3-lap: ${baseline.photoFinishPct.toFixed(2)}%   5-lap: ${main.photoFinishPct.toFixed(2)}%   delta: ${delta(baseline.photoFinishPct, main.photoFinishPct, 2)}pp`);

console.log('  Blowout rate (overall, margin ≥5s):');
console.log(`    3-lap: ${baseline.blowoutPct.toFixed(2)}%   5-lap: ${main.blowoutPct.toFixed(2)}%   delta: ${delta(baseline.blowoutPct, main.blowoutPct, 2)}pp`);

console.log('  Headlines (overall):');
console.log(`    avg margin:  ${arrow(baseline.avgMargin, main.avgMargin, 3, 's')}    delta ${delta(baseline.avgMargin, main.avgMargin, 3)}s`);
console.log(`    avg lc/race: ${arrow(baseline.avgLc, main.avgLc, 2)}      delta ${delta(baseline.avgLc, main.avgLc, 2)}`);

// -------------------- PART 3: leaderboard top-20 with bracket-weighted rating --------------------

console.log(`\n${'='.repeat(76)}`);
console.log('PART 3: LEADERBOARD TOP-20 (NEW rating formula with bracket weights)');
console.log('='.repeat(76));
console.log('  Formula: ROUND((elo - AVG(elo) OVER bracket) * (1 + LOG(GREATEST(total_races,1))/3) * bracketWeight)');
console.log('  Bracket weights: T1=1.0, T2=1.5, T3=2.0, T4=2.5');
console.log('  Filters: bots excluded (matches getDroneLeaderboard default).');

// READ-ONLY query
const ratedRows = await sql`
  SELECT
    d.id,
    d.name,
    d.level,
    (CASE
      WHEN d.level BETWEEN 1 AND 5 THEN 'T1'
      WHEN d.level BETWEEN 6 AND 10 THEN 'T2'
      WHEN d.level BETWEEN 11 AND 15 THEN 'T3'
      ELSE 'T4'
    END) AS bracket,
    d.elo_rating,
    d.total_races,
    ROUND(
      (d.elo_rating::float
        - AVG(d.elo_rating::float) OVER (PARTITION BY (CASE
            WHEN d.level BETWEEN 1 AND 5 THEN 1
            WHEN d.level BETWEEN 6 AND 10 THEN 2
            WHEN d.level BETWEEN 11 AND 15 THEN 3
            ELSE 4
          END)))
      * (1 + LOG(GREATEST(d.total_races, 1)::numeric) / 3)
      * (CASE
          WHEN d.level BETWEEN 1 AND 5 THEN 1.0
          WHEN d.level BETWEEN 6 AND 10 THEN 1.5
          WHEN d.level BETWEEN 11 AND 15 THEN 2.0
          WHEN d.level BETWEEN 16 AND 20 THEN 2.5
        END)
    )::int AS rating
  FROM drones d
  WHERE d.is_bot = false
  ORDER BY rating DESC NULLS LAST
  LIMIT 20
`;

console.log(`\n  ${pad('rank', 5)} ${pad('drone', 26)} ${pad('lvl', 4)} ${pad('br', 3)} ${pad('elo', 5)} ${pad('races', 6)} ${pad('rating', 7)}`);
const bracketCounts = { T1: 0, T2: 0, T3: 0, T4: 0 };
for (let i = 0; i < ratedRows.length; i++) {
  const r = ratedRows[i];
  bracketCounts[r.bracket] = (bracketCounts[r.bracket] || 0) + 1;
  console.log(
    `  ${padR(i + 1, 5)} ${pad(r.name, 26)} ${padR(r.level, 4)} ${pad(r.bracket, 3)} ${padR(r.elo_rating, 5)} ${padR(r.total_races, 6)} ${padR(r.rating, 7)}`,
  );
}
console.log(`\n  Bracket distribution among top 20: T1=${bracketCounts.T1}  T2=${bracketCounts.T2}  T3=${bracketCounts.T3}  T4=${bracketCounts.T4}`);

console.log('\n=== Done ===\n');
