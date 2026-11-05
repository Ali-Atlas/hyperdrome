#!/usr/bin/env node
/**
 * End-to-end smoke test on testnet (SPEC.md 13; ENGINEERING.md 3), the check before every deploy.
 * Against a running app it plays one new demo account through the whole loop: Play Demo, the
 * bootstrap to `done`, 20 stat points, the drone active, a scheduler tick that commits its race,
 * the next slot, a tick that settles it. Then it asserts: the race row is settled, the server
 * replay matches, the drone's on-chain ELO moved, the settle transaction's explorer link is a
 * NearBlocks URL and GET /api/health answers 200.
 *
 *   npm run smoke                                   # http://localhost:3000
 *   SMOKE_BASE_URL=https://app.url npm run smoke    # any deployment
 *
 * Environment: `SMOKE_BASE_URL`, `CRON_SECRET` and the chain adapter's variables (SPEC.md 15; the
 * on-chain reads go through lib/near). Racing must be on (`npm run seed:world -- --racing-on`).
 * Exit 0 with a report on a pass, exit 1 naming the failed assertion. The demo account stays:
 * one per run, counted against `DEMO_ACCOUNT_CAP` and the 5 per IP per hour limit.
 */
import { randomUUID } from 'node:crypto';
import { STAT_KEYS } from '../lib/game-engine/templates.js';
import { getNear } from '../lib/near/index.js';

/** Stat points a level 1 starter drone can take: TSB(1) - 9 (SPEC.md 2.1). */
const POINTS = 20;
/** Slots the drone may wait for a matchup, and a committed race for its settlement. */
const SLOT_TRIES = 3;
const BOOTSTRAP_DEADLINE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_MS = 3_000;

const base = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:3000');
const secret = process.env.CRON_SECRET;
const startedAt = Date.now();
/** @type {Map<string, string>} */
const jar = new Map();
/** @type {string[]} */
const passed = [];
/** @type {[string, string][]} */
const facts = [];

/** @param {string} line */
const say = (line) => void process.stdout.write(`${line}\n`);
/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A failed assertion: `name` is what the report names. */
class SmokeFailure extends Error {
  /**
   * @param {string} name
   * @param {string} detail
   */
  constructor(name, detail) {
    super(detail);
    this.assertion = name;
  }
}

/**
 * Record a passed assertion or stop the run on a failed one.
 * @param {string} name
 * @param {unknown} condition
 * @param {string} detail what was seen, shown when the assertion fails
 * @returns {asserts condition}
 */
function check(name, condition, detail) {
  if (!condition) throw new SmokeFailure(name, detail);
  passed.push(name);
}

/**
 * One request with the cookie jar and the Origin header a browser sends.
 * @param {'GET' | 'POST'} method
 * @param {string} path
 * @param {{ body?: unknown, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, json: any, text: string }>}
 */
async function call(method, path, { body, headers = {} } = {}) {
  const res = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    headers: {
      origin: base.origin,
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  for (const cookie of res.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const at = pair.indexOf('=');
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (an HTML error page): the caller reports `text`.
  }
  return { status: res.status, json, text };
}

/** @param {{ status: number, json: any, text: string }} res */
const seen = (res) => `HTTP ${res.status} ${res.json?.error ?? res.text.slice(0, 200)}`;

/** The drone's state on chain. @param {string} token */
async function chainDrone(token) {
  const view =
    /** @type {{ hot: { elo: number, wins: number, losses: number }, cold: { stats: number[] } } | null} */ (
      await getNear().view('get_drone', { token })
    );
  if (!view) throw new SmokeFailure('drone on chain', `get_drone(${token}) returned null`);
  return view;
}

/** Play Demo, then the bootstrap until `done`. */
async function signUp() {
  const demo = await call('POST', '/api/auth/demo');
  check('Play Demo signs in', demo.status === 200 && jar.size > 0, seen(demo));
  const deadline = Date.now() + BOOTSTRAP_DEADLINE_MS;
  let failures = 0;
  while (Date.now() < deadline) {
    const res = await call('POST', '/api/auth/bootstrap');
    if (res.status === 200 && res.json?.state === 'done') {
      check('bootstrap reaches done', res.json.accountId && res.json.droneId, seen(res));
      return /** @type {{ accountId: string, droneId: string }} */ (res.json);
    }
    if (res.status === 202) {
      say(`  bootstrap: ${res.json?.state ?? 'pending'}`);
      if (res.json?.busy || res.json?.pending) await sleep(RETRY_MS);
      continue;
    }
    // A chain step can fail once (an RPC hiccup, a stale ops nonce); the next call resumes it.
    failures += 1;
    if (res.status !== 502 || failures > 3) {
      throw new SmokeFailure('bootstrap reaches done', seen(res));
    }
    await sleep(RETRY_MS);
  }
  throw new SmokeFailure('bootstrap reaches done', 'not done after 5 minutes');
}

/**
 * Allocate the starter drone's 20 points, one at a time across the 9 stats.
 * @param {{ id: string } & Record<string, number>} drone
 */
async function allocate(drone) {
  const stats = STAT_KEYS.map((k) => drone[k]);
  for (let i = 0; i < POINTS; i++) stats[i % stats.length] += 1;
  const body = { actionId: randomUUID(), stats };
  for (let attempt = 0; ; attempt++) {
    const res = await call('POST', `/api/drones/${drone.id}/allocate`, { body });
    // 202: the outcome is unknown; the same action id again resolves it (SPEC.md 8).
    if (res.status === 202 && attempt < 10) {
      await sleep(RETRY_MS);
      continue;
    }
    check('allocate 20 points', res.status === 200 && res.json?.txHash, seen(res));
    return { stats, explorerUrl: /** @type {string} */ (res.json.explorerUrl) };
  }
}

/** One scheduler tick, as an external scheduler sends it. */
async function tick() {
  const res = await call('POST', '/api/races/run', {
    headers: { 'x-cron-secret': String(secret) },
  });
  if (res.status !== 200) throw new SmokeFailure('scheduler tick', seen(res));
  say(`  tick: ${JSON.stringify(res.json.data)}`);
  return res.json.data;
}

/** The slot the clock is in, and when the next one starts. */
async function clock() {
  const res = await call('GET', '/api/races/next');
  if (res.status !== 200) throw new SmokeFailure('race clock', seen(res));
  const { slot, nextRaceAt, paused } = res.json.data;
  return { slot: slot - 1, nextSlotAt: Date.parse(nextRaceAt), paused: Boolean(paused) };
}

/** Sleep until the next slot has started. */
async function nextSlot() {
  const { slot, nextSlotAt } = await clock();
  const wait = Math.max(0, nextSlotAt - Date.now()) + 2_000;
  say(`  waiting ${Math.round(wait / 1000)} s for slot ${slot + 1}`);
  await sleep(wait);
}

/**
 * Tick until the drone has a race in a committed batch.
 * @param {string} droneId
 */
async function enterBatch(droneId) {
  for (let attempt = 1; attempt <= SLOT_TRIES; attempt++) {
    const data = await tick();
    if (data.commit?.failed) {
      throw new SmokeFailure('batch committed', `commit_batch refused: ${data.commit.failed}`);
    }
    const res = await call('GET', '/api/races/upcoming');
    if (res.status !== 200) throw new SmokeFailure('upcoming races', seen(res));
    const race = res.json.data.races.find(
      (/** @type {{ userDroneId: string | null }} */ r) => r.userDroneId === droneId
    );
    if (race) return race;
    if (attempt < SLOT_TRIES) await nextSlot();
  }
  throw new SmokeFailure(
    'drone enters a batch',
    `no race for the drone after ${SLOT_TRIES} slots; its bracket needs an opponent (seed-world mints the bots)`
  );
}

/**
 * Tick in later slots until the race is settled.
 * @param {{ id: string, batchSlot: number }} race
 */
async function settle(race) {
  for (let attempt = 1; attempt <= SLOT_TRIES; attempt++) {
    if ((await clock()).slot <= race.batchSlot || attempt > 1) await nextSlot();
    await tick();
    const res = await call('GET', `/api/races/${race.id}`);
    if (res.status !== 200) throw new SmokeFailure('race detail', seen(res));
    if (res.json.data.status !== 'pending') return res.json.data;
  }
  throw new SmokeFailure('race row is settled', `still pending after ${SLOT_TRIES} slots`);
}

async function main() {
  if (!secret) throw new SmokeFailure('environment', 'CRON_SECRET is not set');
  say(`Hyperdrome smoke against ${base.origin}`);
  const before = await clock();
  check(
    'racing is on',
    !before.paused,
    'admin_config.racing_enabled is not true (npm run seed:world -- --racing-on)'
  );

  const { accountId, droneId } = await signUp();
  const fleet = await call('GET', '/api/drones');
  const drone = fleet.json?.data?.find((/** @type {{ id: string }} */ d) => d.id === droneId);
  check('starter drone is cached', drone?.tokenId, seen(fleet));
  facts.push(['player', `${accountId}  ${getNear().explorerAccount(accountId)}`]);
  const eloBefore = (await chainDrone(drone.tokenId)).hot.elo;

  const allocation = await allocate(drone);
  const allocated = (await chainDrone(drone.tokenId)).cold.stats;
  check(
    'allocation is on chain',
    JSON.stringify(allocated) === JSON.stringify(allocation.stats),
    `chain stats ${JSON.stringify(allocated)}, sent ${JSON.stringify(allocation.stats)}`
  );
  facts.push(['drone', `${drone.name} ${drone.tokenId}, stats ${allocated.join(' ')}`]);
  facts.push(['allocate tx', allocation.explorerUrl]);

  const toggled = await call('POST', `/api/drones/${droneId}/toggle`, { body: { active: true } });
  check('drone is active', toggled.status === 200 && toggled.json?.data?.active, seen(toggled));

  const matchup = await enterBatch(droneId);
  check('drone enters a batch', Number.isInteger(matchup.batchSlot), JSON.stringify(matchup));
  const race = await settle(matchup);

  check(
    'race row is settled',
    race.status === 'completed' && race.winnerDroneId && race.settleTx,
    `status ${race.status}, winner ${race.winnerDroneId}, settle_tx ${race.settleTx}`
  );
  const verify = await call('GET', `/api/races/${race.id}/verify`);
  check('verify answers match true', verify.json?.data?.match === true, seen(verify));
  const after = await chainDrone(drone.tokenId);
  check(
    'on-chain ELO moved',
    after.hot.elo !== eloBefore && after.hot.wins + after.hot.losses === 1,
    `ELO ${eloBefore} -> ${after.hot.elo}, record ${after.hot.wins}-${after.hot.losses}`
  );
  const link = URL.canParse(race.settleExplorerUrl) ? new URL(race.settleExplorerUrl) : null;
  check(
    'settle tx link is a NearBlocks URL',
    link?.protocol === 'https:' &&
      (link.hostname === 'nearblocks.io' || link.hostname.endsWith('.nearblocks.io')) &&
      link.pathname === `/txns/${race.settleTx}`,
    `settleExplorerUrl ${race.settleExplorerUrl}`
  );
  const health = await call('GET', '/api/health');
  check(
    'GET /api/health answers 200',
    health.status === 200 && health.json?.data?.ok,
    seen(health)
  );

  const won = race.winnerDroneId === droneId;
  const mine = race.drone1Id === droneId ? race.drone1Time : race.drone2Time;
  const theirs = race.drone1Id === droneId ? race.drone2Time : race.drone1Time;
  const opponent = race.drone1Id === droneId ? race.drone2 : race.drone1;
  facts.push(
    ['race', `${race.id}, slot ${race.batchSlot} index ${race.raceIndex}`],
    [
      'result',
      `${won ? 'won' : 'lost'} ${Number(mine).toFixed(3)} s to ${Number(theirs).toFixed(3)} s against ${opponent?.name}${opponent?.isBot ? ' (bot)' : ''} on ${race.track?.name}, ${race.weather}, ${race.timeOfDay}`,
    ],
    ['ELO on chain', `${eloBefore} -> ${after.hot.elo}`],
    ['settle tx', race.settleExplorerUrl],
    [
      'health',
      `database ${health.json.data.database.ok}, rpc ${health.json.data.rpc.ok}, last tick slot ${health.json.data.scheduler.lastTickSlot} (${health.json.data.scheduler.lastTickAgeSeconds} s ago), racing ${health.json.data.racingEnabled}`,
    ]
  );
}

/** @param {string} verdict */
function report(verdict) {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  say(`\nHyperdrome smoke: ${verdict} (${Math.floor(seconds / 60)} min ${seconds % 60} s)`);
  say(`  ${'target'.padEnd(13)} ${base.origin}`);
  for (const [label, value] of facts) say(`  ${label.padEnd(13)} ${value}`);
  for (const name of passed) say(`  ok    ${name}`);
}

try {
  await main();
  report('PASS');
  process.exit(0);
} catch (err) {
  report('FAIL');
  if (err instanceof SmokeFailure) {
    say(`  FAIL  ${err.assertion}: ${err.message}`);
  } else {
    say(
      `  FAIL  unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    );
  }
  process.exit(1);
}
