#!/usr/bin/env node
/**
 * End-to-end smoke test on testnet (SPEC.md 13; ENGINEERING.md 3), the check before every deploy.
 * Against a running app it plays one new demo account through the whole loop: Play Demo, the
 * bootstrap to `done`, 20 stat points, the mod unequipped and equipped again, the drone active, a
 * scheduler tick that commits its race, the next slot, a tick that settles it. Then it asserts: the
 * race row is settled, the server replay matches, the race row carries the player's Volts and both
 * rating changes, the drone's on-chain ELO moved, the settle transaction's explorer link is a
 * NearBlocks URL and GET /api/health answers 200.
 *
 *   npm run smoke                                   # http://localhost:3000
 *   SMOKE_BASE_URL=https://app.url npm run smoke    # any deployment
 *
 * Environment: `SMOKE_BASE_URL`, `CRON_SECRET` and the chain adapter's variables (SPEC.md 15; the
 * on-chain reads go through lib/near). Racing must be on (`npm run seed:world -- --racing-on`).
 * Exit 0 with a report on a pass, exit 1 naming the failed assertion. The demo account stays, its
 * drone inactive: one per run, counted against `DEMO_ACCOUNT_CAP` and the 5 per IP per hour limit.
 * The target may have its own scheduler: a slot it already ticked is read, then waited out.
 */
import { randomUUID } from 'node:crypto';
import { STAT_KEYS } from '../lib/game-engine/templates.js';
import { getNear } from '../lib/near/index.js';
import {
  RETRY_MS,
  SmokeFailure,
  base,
  call,
  check,
  hasSession,
  passed,
  say,
  seen,
  sleep,
} from './smoke-client.mjs';

/** Stat points a level 1 starter drone can take: TSB(1) - 9 (SPEC.md 2.1). */
const POINTS = 20;
/** Slots the drone may wait for a matchup, and a committed race for its settlement. */
const SLOT_TRIES = 3;
const BOOTSTRAP_DEADLINE_MS = 5 * 60_000;
/** How long another scheduler's tick, still running, is given to write its rows. */
const OTHER_TICK_MS = 60_000;

const secret = process.env.CRON_SECRET;
const startedAt = Date.now();
/** @type {[string, string][]} */
const facts = [];

/** The drone's state on chain. @param {string} token */
async function chainDrone(token) {
  const view =
    /** @type {{ hot: { elo: number, wins: number, losses: number, equipped_mod: string | null }, cold: { stats: number[] } } | null} */ (
      await getNear().view('get_drone', { token })
    );
  if (!view) throw new SmokeFailure('drone on chain', `get_drone(${token}) returned null`);
  return view;
}

/** Play Demo, then the bootstrap until `done`. */
async function signUp() {
  const demo = await call('POST', '/api/auth/demo');
  check('Play Demo signs in', demo.status === 200 && hasSession(), seen(demo));
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
 * One chain action of the player (SPEC.md 8): a 202 means the outcome is unknown, and the same
 * action id again resolves it.
 * @param {string} name the assertion this action is
 * @param {string} path
 * @param {Record<string, unknown>} fields the body without its action id
 * @returns {Promise<string>} the transaction's explorer link
 */
async function action(name, path, fields) {
  const body = { actionId: randomUUID(), ...fields };
  for (let attempt = 0; ; attempt++) {
    const res = await call('POST', path, { body });
    if (res.status === 202 && attempt < 10) {
      await sleep(RETRY_MS);
      continue;
    }
    check(name, res.status === 200 && res.json?.txHash, seen(res));
    return res.json.explorerUrl;
  }
}

/**
 * Allocate the starter drone's 20 points, one at a time across the 9 stats.
 * @param {{ id: string } & Record<string, number>} drone
 */
async function allocate(drone) {
  const stats = STAT_KEYS.map((k) => drone[k]);
  for (let i = 0; i < POINTS; i++) stats[i % stats.length] += 1;
  const explorerUrl = await action('allocate 20 points', `/api/drones/${drone.id}/allocate`, {
    stats,
  });
  return { stats, explorerUrl };
}

/**
 * Take the starter mod off and put it back (SPEC.md 4.4 `equip`), checking the chain each time.
 * @param {{ id: string, tokenId: string }} drone
 */
async function reequip(drone) {
  const mod = (await chainDrone(drone.tokenId)).hot.equipped_mod;
  check('starter mod is equipped', mod, 'get_drone shows no equipped mod after the bootstrap');
  const path = `/api/drones/${drone.id}/equip`;
  await action('unequip the mod', path, { kind: 'mod', item: null });
  const off = (await chainDrone(drone.tokenId)).hot.equipped_mod;
  check('mod is off on chain', off === null, `equipped_mod ${off}`);
  const explorerUrl = await action('equip the mod', path, { kind: 'mod', item: mod });
  const on = (await chainDrone(drone.tokenId)).hot.equipped_mod;
  check('mod is equipped on chain', on === mod, `equipped_mod ${on}, expected ${mod}`);
  return { mod, explorerUrl };
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

/** The slot the server's clock is in, and how long until the next one starts. */
async function clock() {
  const res = await call('GET', '/api/races/next');
  if (res.status !== 200) throw new SmokeFailure('race clock', seen(res));
  const { slot, nextRaceAt, paused } = res.json.data;
  // Measured on the server's clock, so a skewed clock on this machine does not move the wait.
  const untilNext = Math.max(0, Date.parse(nextRaceAt) - res.date);
  return { slot: slot - 1, untilNext, paused: Boolean(paused) };
}

/** Sleep until the next slot has started. */
async function nextSlot() {
  const { slot, untilNext } = await clock();
  // The `Date` header has whole seconds; 3 s clears that and the slot edge.
  const wait = untilNext + 3_000;
  say(`  waiting ${Math.round(wait / 1000)} s for slot ${slot + 1}`);
  await sleep(wait);
}

/**
 * Read until `found` answers. One read when this run's own tick did the work; when another
 * scheduler holds the slot (`claimed: false`), its tick may still be writing, so keep reading.
 * @template T
 * @param {boolean} claimed
 * @param {() => Promise<T | null>} found
 * @returns {Promise<T | null>}
 */
async function readAfterTick(claimed, found) {
  const deadline = Date.now() + (claimed ? 0 : OTHER_TICK_MS);
  for (;;) {
    const value = await found();
    if (value !== null || Date.now() >= deadline) return value;
    await sleep(RETRY_MS);
  }
}

/**
 * Tick until the drone has a race in a committed batch.
 * @param {string} droneId
 * @returns {Promise<{ id: string, batchSlot: number }>}
 */
async function enterBatch(droneId) {
  for (let attempt = 1; attempt <= SLOT_TRIES; attempt++) {
    const data = await tick();
    if (data.commit?.failed) {
      throw new SmokeFailure('batch committed', `commit_batch refused: ${data.commit.failed}`);
    }
    const race = await readAfterTick(data.claimed, async () => {
      const res = await call('GET', '/api/races/upcoming');
      if (res.status !== 200) throw new SmokeFailure('upcoming races', seen(res));
      const mine = res.json.data.races.find(
        (/** @type {{ userDroneId: string | null }} */ r) => r.userDroneId === droneId
      );
      return mine ?? null;
    });
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
    const data = await tick();
    const settled = await readAfterTick(data.claimed, async () => {
      const res = await call('GET', `/api/races/${race.id}`);
      if (res.status !== 200) throw new SmokeFailure('race detail', seen(res));
      return res.json.data.status === 'pending' ? null : res.json.data;
    });
    if (settled) return settled;
  }
  throw new SmokeFailure('race row is settled', `still pending after ${SLOT_TRIES} slots`);
}

/**
 * The server's replay of the race. The batch's seed is stored just after its races are completed,
 * so a 409 right behind a settle is read again.
 * @param {string} raceId
 */
async function verified(raceId) {
  for (let attempt = 1; ; attempt++) {
    const res = await call('GET', `/api/races/${raceId}/verify`);
    if (res.status !== 409 || attempt >= 5) return res;
    await sleep(RETRY_MS);
  }
}

async function main() {
  if (!secret) throw new SmokeFailure('environment', 'CRON_SECRET is not set');
  say(`Hyperdrome smoke against ${base.origin}`);
  // Read the adapter's configuration before anything is created: a bad one costs no demo account.
  const near = getNear();
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
  facts.push(['player', `${accountId}  ${near.explorerAccount(accountId)}`]);
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
  const equipped = await reequip(drone);
  facts.push(['equip tx', `${equipped.mod}  ${equipped.explorerUrl}`]);

  const toggle = `/api/drones/${droneId}/toggle`;
  const toggled = await call('POST', toggle, { body: { active: true } });
  check('drone is active', toggled.status === 200 && toggled.json?.data?.active, seen(toggled));

  const matchup = await enterBatch(droneId);
  check('drone enters a batch', Number.isInteger(matchup.batchSlot), JSON.stringify(matchup));
  // One race is enough: inactive, the drone is in no later batch and its record stays at 1.
  const parked = await call('POST', toggle, { body: { active: false } });
  check('drone is parked', parked.status === 200 && !parked.json?.data?.active, seen(parked));
  const race = await settle(matchup);

  check(
    'race row is settled',
    race.status === 'completed' && race.winnerDroneId && race.settleTx,
    `status ${race.status}, winner ${race.winnerDroneId}, settle_tx ${race.settleTx}`
  );
  const verify = await verified(race.id);
  check('verify answers match true', verify.json?.data?.match === true, seen(verify));
  // Read again: the rewards are written with the settle events, after the row turns completed.
  const row = (await call('GET', `/api/races/${race.id}`)).json?.data ?? {};
  const won = row.winnerDroneId === droneId;
  const volts = won ? row.pointsAwarded : row.loserPointsAwarded;
  check(
    'race row has the Volts and both rating changes',
    volts > 0 && row.drone1EloChange !== 0 && row.drone2EloChange !== 0,
    `player ${won ? 'won' : 'lost'}: winner Volts ${row.pointsAwarded}, loser Volts ${row.loserPointsAwarded}, rating changes ${row.drone1EloChange} and ${row.drone2EloChange}`
  );
  const after = await chainDrone(drone.tokenId);
  check(
    'on-chain ELO moved',
    after.hot.elo !== eloBefore && after.hot.wins + after.hot.losses === 1,
    `ELO ${eloBefore} -> ${after.hot.elo}, record ${after.hot.wins}-${after.hot.losses} (a rating 720 or more away from the opponent's moves by 0)`
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

  const mine = race.drone1Id === droneId ? race.drone1Time : race.drone2Time;
  const theirs = race.drone1Id === droneId ? race.drone2Time : race.drone1Time;
  const opponent = race.drone1Id === droneId ? race.drone2 : race.drone1;
  facts.push(
    ['race', `${race.id}, slot ${race.batchSlot} index ${race.raceIndex}`],
    [
      'result',
      `${won ? 'won' : 'lost'} ${Number(mine).toFixed(3)} s to ${Number(theirs).toFixed(3)} s against ${opponent?.name}${opponent?.isBot ? ' (bot)' : ''} on ${race.track?.name}, ${race.weather}, ${race.timeOfDay}`,
    ],
    [
      'race rewards',
      `winner ${row.pointsAwarded} Volts, loser ${row.loserPointsAwarded} Volts, rating ${signed(row.drone1EloChange)} and ${signed(row.drone2EloChange)}`,
    ],
    ['ELO on chain', `${eloBefore} -> ${after.hot.elo}`],
    ['settle tx', race.settleExplorerUrl],
    [
      'health',
      `database ${health.json.data.database.ok}, rpc ${health.json.data.rpc.ok}, last tick slot ${health.json.data.scheduler.lastTickSlot} (${health.json.data.scheduler.lastTickAgeSeconds} s ago), racing ${health.json.data.racingEnabled}`,
    ]
  );
}

/** @param {number} n */
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

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
