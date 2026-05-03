/**
 * Race Engine v2 test harness.
 *
 * Runs 100 simulated races against the modified `simulateRace` and
 * reports margin distribution, per-track stats, upset rate, lead-change
 * counts, sample race logs, battery fade, and weather impact.
 *
 * Read-only: no DB writes, no DB reads (tracks hardcoded).
 *
 *   node scripts/test-engine-v2.js
 */

import crypto from 'node:crypto';
import { simulateRace, randomWeather, randomTimeOfDay } from '../lib/game-engine/race-simulator.js';
import { buildStats } from '../lib/game-engine/drone-stats.js';

const TRACKS = [
  { id: 't-keyhole',   name: 'Keyhole',      difficulty: 2,  straights: 2, turns: 2, laps: 3, length: 'short'  },
  { id: 't-crossfire', name: 'Crossfire',    difficulty: 4,  straights: 3, turns: 5, laps: 3, length: 'medium' },
  { id: 't-voltage',   name: 'Voltage Loop', difficulty: 8,  straights: 4, turns: 8, laps: 3, length: 'long'   },
  { id: 't-tempest',   name: 'Tempest Run',  difficulty: 10, straights: 2, turns: 8, laps: 3, length: 'long'   },
];

const LEVELS = [3, 7, 12, 17];
const DRONES_PER_LEVEL = 5;
const NUM_RACES = 100;
const SAMPLE_RACE_LOGS = 3;

function buildDrones() {
  const drones = [];
  for (const level of LEVELS) {
    for (let i = 0; i < DRONES_PER_LEVEL; i++) {
      const { stats, tsb } = buildStats(level);
      drones.push({
        id: crypto.randomUUID(),
        name: `LV${String(level).padStart(2, '0')}-${i + 1}`,
        level,
        tsb,
        ...stats,
      });
    }
  }
  return drones;
}

function pickPair(drones) {
  const i = Math.floor(Math.random() * drones.length);
  let j = Math.floor(Math.random() * drones.length);
  while (j === i) j = Math.floor(Math.random() * drones.length);
  return [drones[i], drones[j]];
}

function countLeadChanges(raceLog) {
  let cum1 = 0;
  let cum2 = 0;
  let prevLeader = 0; // 0=none, 1=drone1, 2=drone2
  let changes = 0;
  for (const seg of raceLog) {
    cum1 += seg.drone1Time;
    cum2 += seg.drone2Time;
    let leader;
    if (cum1 < cum2) leader = 1;
    else if (cum2 < cum1) leader = 2;
    else leader = prevLeader || 1;
    if (prevLeader !== 0 && leader !== prevLeader) changes++;
    prevLeader = leader;
  }
  return changes;
}

function avgSegTimeOnLap(raceLog, lap, droneIdx) {
  const segs = raceLog.filter((s) => s.lap === lap);
  if (segs.length === 0) return null;
  const key = droneIdx === 1 ? 'drone1Time' : 'drone2Time';
  return segs.reduce((acc, s) => acc + s[key], 0) / segs.length;
}

function fmt(n, dp = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return '   -  ';
  return Number(n).toFixed(dp).padStart(8, ' ');
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

// -------------------- run sim --------------------

const drones = buildDrones();
console.log(`\n=== Drones (${drones.length}) ===`);
console.log('name      lvl  tsb  spd  trn  acc  dur  nv   bat  rh   wr   con');
for (const d of drones) {
  console.log(
    `${pad(d.name, 9)} ${String(d.level).padStart(3)} ${String(d.tsb).padStart(4)}` +
      `  ${String(d.speed).padStart(3)}  ${String(d.turning).padStart(3)}  ${String(d.acceleration).padStart(3)}` +
      `  ${String(d.durability).padStart(3)}  ${String(d.nightVision).padStart(3)}  ${String(d.batteryCapacity).padStart(3)}` +
      `  ${String(d.rainHandling).padStart(3)}  ${String(d.windResistance).padStart(3)}  ${String(d.consistency).padStart(3)}`,
  );
}

const races = [];
for (let i = 0; i < NUM_RACES; i++) {
  const [d1, d2] = pickPair(drones);
  const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
  const weather = randomWeather();
  const timeOfDay = randomTimeOfDay();
  const result = simulateRace(d1, d2, track, weather, timeOfDay);
  const margin = Math.abs(result.drone1Time - result.drone2Time);
  const winner = result.winnerId === d1.id ? d1 : d2;
  const loser = result.winnerId === d1.id ? d2 : d1;
  races.push({
    track,
    weather,
    timeOfDay,
    d1,
    d2,
    result,
    margin,
    winner,
    loser,
    upset: winner.tsb < loser.tsb,
    leadChanges: countLeadChanges(result.raceLog),
  });
}

// -------------------- margin distribution --------------------

console.log(`\n=== Margin distribution (${NUM_RACES} races) ===`);
const buckets = [
  { label: '0.000-0.100', test: (m) => m < 0.1 },
  { label: '0.100-0.500', test: (m) => m >= 0.1 && m < 0.5 },
  { label: '0.500-1.000', test: (m) => m >= 0.5 && m < 1.0 },
  { label: '1.000-2.000', test: (m) => m >= 1.0 && m < 2.0 },
  { label: '2.000-5.000', test: (m) => m >= 2.0 && m < 5.0 },
  { label: '5.000-10.00', test: (m) => m >= 5.0 && m < 10.0 },
  { label: '10.00+     ', test: (m) => m >= 10.0 },
];
for (const b of buckets) {
  const count = races.filter((r) => b.test(r.margin)).length;
  const pct = ((100 * count) / races.length).toFixed(1).padStart(5);
  const bar = '█'.repeat(Math.round(count));
  console.log(`  ${b.label}  ${String(count).padStart(3)}  ${pct}%  ${bar}`);
}
const margins = races.map((r) => r.margin).sort((a, b) => a - b);
const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
console.log(`  avg=${avgMargin.toFixed(3)}s  median=${margins[Math.floor(margins.length / 2)].toFixed(3)}s` +
  `  min=${margins[0].toFixed(4)}s  max=${margins[margins.length - 1].toFixed(3)}s`);

// -------------------- per-track --------------------

console.log(`\n=== Per-track stats ===`);
console.log('track            diff  S/T   length  races  avg_margin  avg_d1_time  min_marg  max_marg');
for (const t of TRACKS) {
  const trackRaces = races.filter((r) => r.track.id === t.id);
  if (trackRaces.length === 0) continue;
  const tMargins = trackRaces.map((r) => r.margin);
  const tTimes = trackRaces.map((r) => r.result.drone1Time);
  const avgM = tMargins.reduce((a, b) => a + b, 0) / tMargins.length;
  const avgT = tTimes.reduce((a, b) => a + b, 0) / tTimes.length;
  console.log(
    `${pad(t.name, 17)} ${String(t.difficulty).padStart(3)}   ${t.straights}/${t.turns}   ` +
      `${pad(t.length, 7)} ${String(trackRaces.length).padStart(4)}  ${fmt(avgM)}    ${fmt(avgT, 2)}     ${fmt(Math.min(...tMargins), 4)}  ${fmt(Math.max(...tMargins), 3)}`,
  );
}

// -------------------- upset rate --------------------

console.log(`\n=== Upset rate (lower-TSB wins) ===`);
const tsbDifferent = races.filter((r) => r.winner.tsb !== r.loser.tsb);
const upsets = tsbDifferent.filter((r) => r.upset).length;
const tsbTies = races.length - tsbDifferent.length;
const upsetPct = tsbDifferent.length > 0 ? (100 * upsets) / tsbDifferent.length : 0;
console.log(
  `  total=${races.length}  tsb-different=${tsbDifferent.length}  same-tsb=${tsbTies}  ` +
    `upsets=${upsets}  upset_pct=${upsetPct.toFixed(1)}%`,
);

// -------------------- lead changes --------------------

console.log(`\n=== Lead changes per race ===`);
const lcs = races.map((r) => r.leadChanges);
const avgLc = lcs.reduce((a, b) => a + b, 0) / lcs.length;
console.log(`  avg=${avgLc.toFixed(2)}  min=${Math.min(...lcs)}  max=${Math.max(...lcs)}`);
const lcDist = {};
for (const c of lcs) lcDist[c] = (lcDist[c] || 0) + 1;
const lcKeys = Object.keys(lcDist).map(Number).sort((a, b) => a - b);
console.log('  histogram:');
for (const k of lcKeys) {
  console.log(`    ${String(k).padStart(2)} changes: ${String(lcDist[k]).padStart(3)}  ${'█'.repeat(lcDist[k])}`);
}

// -------------------- battery impact --------------------

console.log(`\n=== Battery fade (lap 1 vs lap 3 avg seg time, per-drone per-race) ===`);
let l1Sum = 0;
let l3Sum = 0;
let lCnt = 0;
for (const r of races) {
  for (const di of [1, 2]) {
    const a1 = avgSegTimeOnLap(r.result.raceLog, 1, di);
    const a3 = avgSegTimeOnLap(r.result.raceLog, 3, di);
    if (a1 !== null && a3 !== null) {
      l1Sum += a1;
      l3Sum += a3;
      lCnt += 1;
    }
  }
}
const lap1Avg = l1Sum / lCnt;
const lap3Avg = l3Sum / lCnt;
const fadePct = ((lap3Avg - lap1Avg) / lap1Avg) * 100;
console.log(`  samples=${lCnt}`);
console.log(`  lap 1 avg seg time: ${lap1Avg.toFixed(4)}s`);
console.log(`  lap 3 avg seg time: ${lap3Avg.toFixed(4)}s`);
console.log(`  fade: ${(lap3Avg - lap1Avg).toFixed(4)}s  (${fadePct >= 0 ? '+' : ''}${fadePct.toFixed(2)}%)`);

// also break down by track length to show length-multiplier effect
console.log(`  by track length:`);
for (const len of ['short', 'medium', 'long']) {
  let s1 = 0, s3 = 0, c = 0;
  for (const r of races) {
    if (r.track.length !== len) continue;
    for (const di of [1, 2]) {
      const a1 = avgSegTimeOnLap(r.result.raceLog, 1, di);
      const a3 = avgSegTimeOnLap(r.result.raceLog, 3, di);
      if (a1 !== null && a3 !== null) { s1 += a1; s3 += a3; c++; }
    }
  }
  if (c === 0) { console.log(`    ${pad(len, 7)} (no samples)`); continue; }
  const a1 = s1 / c, a3 = s3 / c;
  console.log(`    ${pad(len, 7)} samples=${String(c).padStart(3)}  lap1=${a1.toFixed(4)}s  lap3=${a3.toFixed(4)}s  fade=${((a3 - a1) / a1 * 100).toFixed(2)}%`);
}

// -------------------- weather impact --------------------

console.log(`\n=== Weather impact ===`);
const clearDay = races.filter((r) => r.weather === 'clear' && r.timeOfDay === 'day');
const heavyRainNight = races.filter((r) => r.weather === 'heavy_rain' && r.timeOfDay === 'night');
function summary(group, label) {
  if (group.length === 0) return `  ${label}: (no samples)`;
  const m = group.map((r) => r.margin);
  const t = group.map((r) => r.result.drone1Time);
  return `  ${pad(label, 22)} n=${String(group.length).padStart(3)}  avg_margin=${(m.reduce((a, b) => a + b, 0) / m.length).toFixed(3)}s  avg_d1_time=${(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2)}s`;
}
console.log(summary(clearDay, 'clear/day'));
console.log(summary(heavyRainNight, 'heavy_rain/night'));

// also: by-weather rollup
console.log(`  by weather (all times-of-day):`);
const weathers = ['clear', 'clouds', 'rain', 'heavy_rain', 'wind', 'haze', 'fog'];
for (const w of weathers) {
  const g = races.filter((r) => r.weather === w);
  if (g.length === 0) continue;
  const m = g.map((r) => r.margin);
  console.log(`    ${pad(w, 11)} n=${String(g.length).padStart(3)}  avg_margin=${(m.reduce((a, b) => a + b, 0) / m.length).toFixed(3)}s`);
}
console.log(`  by time of day:`);
for (const tod of ['dawn', 'day', 'dusk', 'night']) {
  const g = races.filter((r) => r.timeOfDay === tod);
  if (g.length === 0) continue;
  const m = g.map((r) => r.margin);
  console.log(`    ${pad(tod, 6)} n=${String(g.length).padStart(3)}  avg_margin=${(m.reduce((a, b) => a + b, 0) / m.length).toFixed(3)}s`);
}

// -------------------- sample race logs --------------------

console.log(`\n=== Sample race logs (${SAMPLE_RACE_LOGS} races) ===`);
// Pick: one close race, one moderate margin, one blowout, if available
const sortedByMargin = [...races].sort((a, b) => a.margin - b.margin);
const samples = [
  sortedByMargin[0],
  sortedByMargin[Math.floor(sortedByMargin.length / 2)],
  sortedByMargin[sortedByMargin.length - 1],
].slice(0, SAMPLE_RACE_LOGS);

for (const [idx, r] of samples.entries()) {
  console.log(
    `\n--- Sample ${idx + 1} ---  ${r.track.name} (diff ${r.track.difficulty}, ${r.track.straights}S/${r.track.turns}T, ${r.track.length})  ` +
      `weather=${r.weather}/${r.timeOfDay}`,
  );
  console.log(`    drone1 ${r.d1.name} (TSB ${r.d1.tsb}, spd=${r.d1.speed} trn=${r.d1.turning} bat=${r.d1.batteryCapacity} con=${r.d1.consistency})`);
  console.log(`    drone2 ${r.d2.name} (TSB ${r.d2.tsb}, spd=${r.d2.speed} trn=${r.d2.turning} bat=${r.d2.batteryCapacity} con=${r.d2.consistency})`);
  console.log(`    total: d1=${r.result.drone1Time.toFixed(4)}s  d2=${r.result.drone2Time.toFixed(4)}s  margin=${r.margin.toFixed(4)}s  ` +
    `winner=${r.winner.name}  lead_changes=${r.leadChanges}`);
  console.log('    seg lap type      sDiff   d1_time  d2_time   cum_gap (d1-d2)');
  let c1 = 0, c2 = 0;
  for (const seg of r.result.raceLog) {
    c1 += seg.drone1Time;
    c2 += seg.drone2Time;
    const gap = c1 - c2;
    const gapStr = (gap >= 0 ? '+' : '') + gap.toFixed(4);
    console.log(
      `    ${String(seg.segment).padStart(3)} ${String(seg.lap).padStart(3)} ${pad(seg.type, 9)} ${seg.segmentDifficulty.toFixed(4)}` +
        `   ${seg.drone1Time.toFixed(4)}  ${seg.drone2Time.toFixed(4)}   ${gapStr}`,
    );
  }
}

console.log('\n=== Done ===\n');
