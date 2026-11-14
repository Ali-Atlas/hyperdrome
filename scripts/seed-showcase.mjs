#!/usr/bin/env node
/**
 * Showcase seed (SPEC.md 6, Showcase seed): mints a kit to the operator's account and seeds
 * marketplace listings from four pilot accounts, on the chain and in the database of the loaded
 * env files. It prints the full plan first and sends nothing until the operator types `go`.
 * Idempotent: every step has a fixed action id, so a second run sends nothing and a stopped run
 * resumes.
 *
 *   npm run seed:showcase -- --account p-<slug>.game.hyperdrome.testnet          # plan, then asks
 *   npm run seed:showcase -- --account p-<slug>.game.hyperdrome.testnet --plan   # plan only
 *   npm run seed:showcase -- --account p-<slug>.game.hyperdrome.testnet --go     # no question
 *
 * `npm run seed:showcase` reads `.env.local`. For production, load the production values after
 * it: `node --env-file=.env.local --env-file=.env.prod.local --import ./scripts/register-alias.mjs
 * scripts/seed-showcase.mjs --account <account>`.
 */
import { createInterface } from 'node:readline/promises';
import { droneTier } from '../lib/game-engine/skin-templates.js';
import { getNear } from '../lib/near/index.js';
import { estimateCost } from '../lib/showcase/cost.js';
import {
  OPERATOR_KIT,
  PILOTS,
  droneStats,
  dronePrice,
  itemInfo,
  pilotKit,
} from '../lib/showcase/plan.js';
import { slugFromUsername } from '../lib/validators/player-slug.js';

const { SeedBlockedError, seedShowcase } = await import('../services/showcase-seed.service.js');
const { showcaseStatus } = await import('../services/showcase-status.js');

/** @param {string} [line] */
const say = (line = '') => void process.stdout.write(`${line}\n`);
/** @param {number} n */
const num = (n) => n.toLocaleString('en-US');
/** @param {bigint} yocto @returns {string} NEAR with 3 decimals */
const near3 = (yocto) => (Number(yocto / 10n ** 21n) / 1000).toFixed(3);

const flag = (/** @type {string} */ name) => process.argv.includes(name);
const accountAt = process.argv.indexOf('--account');
const operatorAccount = accountAt > 0 ? process.argv[accountAt + 1] : undefined;
if (!operatorAccount) {
  console.error(
    'usage: seed-showcase.mjs --account <the operator NEAR account id> [--plan | --go]'
  );
  process.exit(1);
}

const near = getNear();

/**
 * @param {'skin' | 'mod'} kind
 * @param {number} template
 */
const item = (kind, template) => {
  const { name, rarity } = itemInfo(kind, template);
  return `${name} (${rarity})`;
};

/** @param {import('../lib/showcase/plan.js').DroneSpec} drone */
function droneLines(drone) {
  say(
    `  drone ${drone.name}: level ${drone.level}, tier ${droneTier(drone.level)}, ${drone.build} build, stats ${droneStats(drone).join(' ')}`
  );
  const bound = [
    ...drone.skins.map((t) => `skin ${item('skin', t)}`),
    ...drone.mods.map((t) => `mod ${item('mod', t)}`),
  ];
  say(`    bound: ${bound.join(', ')}`);
}

/** @param {Awaited<ReturnType<typeof showcaseStatus>>} status */
function printPlan(status) {
  const kit = OPERATOR_KIT;
  say(`Showcase seed on ${near.gameId} (owner ${near.ownerId})`);
  say();
  say(`1. Operator account ${status.operator.accountId} (${status.operator.username})`);
  say(
    `  now: ${num(status.operatorVolts)} Volts, ${near3(status.operatorBalance)} NEAR for its own gas`
  );
  kit.drones.forEach(droneLines);
  say(`  unbound skins: ${kit.skins.map((t) => item('skin', t)).join(', ')}`);
  say(`  unbound mods: ${kit.mods.map((t) => item('mod', t)).join(', ')}`);
  say(`  Volts: ${num(kit.volts)} minted once`);
  say();
  say('2. Pilot accounts (created through the player bootstrap, 1 active slot each)');
  for (const pilot of PILOTS) {
    const seeded = status.progress.find((p) => p.username === pilot.username);
    const account =
      seeded?.accountId ?? `p-${slugFromUsername(pilot.username)}.${near.gameId} (new)`;
    say(`  ${pilot.username}: ${account}`);
    droneLines(pilot.drone);
    say(`    listed at ${num(dronePrice(pilot.drone))} Volts, with its bound items`);
    droneLines(pilot.racer);
    say('    kept, not listed, set active (the starter drone is set inactive)');
    for (const { kind, template, price } of pilot.listings) {
      say(`    ${kind} ${item(kind, template)}: listed at ${num(price)} Volts`);
    }
    say(`    listings: ${Object.keys(pilotKit(pilot).prices).length}`);
  }
  say();
  say('3. Skin supply (template: minted now + this plan / cap)');
  say(
    `  ${status.supply
      .map((s) => `${itemInfo('skin', s.template).name} ${s.minted}+${s.planned}/${s.cap}`)
      .join(', ')}`
  );
  say();
  const cost = estimateCost();
  say('4. Transactions and NEAR (estimate, from the SPEC 15 measurements)');
  say(
    `  ${cost.transactions} transactions: ${cost.mints} mints, ${cost.binds} binds, ${cost.lists} listings, 4 sign-ups`
  );
  say(
    `  ops key: about ${cost.opsNear.toFixed(2)} NEAR of ${status.funding.opsAllowance === null ? 'an unlimited allowance' : `${near3(status.funding.opsAllowance)} left`}`
  );
  say(
    `  game account: about ${cost.gameNear.toFixed(2)} NEAR of ${near3(status.funding.gameAvailable)} available (4 accounts at 0.05, storage)`
  );
  say(`  each account's own gas: under ${cost.playerNear.toFixed(3)} NEAR of its 0.05`);
  say();
  say('5. Racing (2.3: same level bracket, nearest rating first, never the same owner)');
  const racing = status.racing.filter((r) => r.active).map((r) => r.name);
  say(
    `  your active slots: ${status.slots} at ${num(status.lifetimeRaces)} lifetime races. Set active: ${racing.join(', ')}. Your active starter drone is set inactive to free the slot. The others stay inactive until you switch on the drones page.`
  );
  for (const r of status.racing) {
    const names = r.opponents
      .slice(0, 4)
      .map((o) => `${o.name} L${o.level} (${o.owner}, rating ${o.eloRating})`);
    const more = r.opponents.length > 4 ? `, and ${r.opponents.length - 4} more` : '';
    say(
      `  ${r.name} L${r.level}, bracket ${r.bracket}${r.active ? ', active' : ''}: ${r.opponents.length} non-bot ${r.opponents.length === 1 ? 'opponent' : 'opponents'}: ${names.join(', ')}${more}`
    );
    say(
      `    bots filling the bracket: ${r.bots}. First pairing at today's ratings: ${r.firstPairing}`
    );
  }
  say(
    '  Ratings move after every race and the pairing takes the nearest rating, so in a bracket with bots some races are against bots.'
  );
  say();
  say('6. Steps already applied (a second run sends nothing for these)');
  for (const p of status.progress) {
    say(`  ${p.username}: setup ${p.state}, ${p.applied} of ${p.steps} steps applied`);
  }
  say();
}

const status = await showcaseStatus({ operatorAccount });
printPlan(status);

if (flag('--plan')) process.exit(0);
if (!flag('--go')) {
  if (!process.stdin.isTTY) {
    say('Nothing sent. Run again with --go to send.');
    process.exit(0);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type go to send these transactions: ');
  rl.close();
  if (answer.trim().toLowerCase() !== 'go') {
    say('Nothing sent.');
    process.exit(0);
  }
}

try {
  const reports = await seedShowcase({ operatorAccount }, { log: say });
  say();
  for (const report of reports) {
    const sent = report.steps.filter((s) => !s.replayed).length;
    say(
      `${report.username}: ${report.steps.length} steps, ${sent} sent now, set active: ${report.activated.join(', ') || 'no change'}, ${near.explorerAccount(report.accountId)}`
    );
  }
  process.exit(0);
} catch (err) {
  if (err instanceof SeedBlockedError) {
    console.error(`\nstopped. ${err.message}`);
  } else {
    console.error('\nfailed.', err);
  }
  process.exit(1);
}
