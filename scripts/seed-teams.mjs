#!/usr/bin/env node
/**
 * Seed the AI racing teams (SPEC.md 2.10, 10) on the chain and in the database of `.env.local`:
 * account, budget, three drones, skins, mods, Volts, gas float and play key. Idempotent: a team
 * that is done is skipped and a run that stopped part way resumes where it stopped.
 *
 *   npm run seed:teams              # every team in lib/teams/roster.js
 *   npm run seed:teams -- vortex    # only the named teams
 *
 * Gas: each team account gets 2 NEAR from the owner account. That transfer needs the owner's
 * full-access key, which application code never loads, so the script prints the near-cli-rs
 * command and waits until the NEAR has arrived. Run the command in another terminal.
 */
import { getNear } from '../lib/near/index.js';
import { TEAMS } from '../lib/teams/roster.js';

const { SeedBlockedError, seedTeam } = await import('../services/team-seed.service.js');

/** How often and how long the script looks for the gas transfer. */
const POLL_MS = 5_000;
const WAIT_MS = 30 * 60_000;
const YOCTO_PER_NEAR = 10n ** 24n;

/** @param {string} line */
const say = (line) => void process.stdout.write(`${line}\n`);

const wanted = process.argv.slice(2);
const unknown = wanted.filter((slug) => !TEAMS.some((t) => t.slug === slug));
if (unknown.length > 0) {
  console.error(
    `unknown team: ${unknown.join(', ')} (known: ${TEAMS.map((t) => t.slug).join(', ')})`
  );
  process.exit(1);
}
const defs = wanted.length > 0 ? TEAMS.filter((t) => wanted.includes(t.slug)) : TEAMS;
const near = getNear();
const network = process.env.NEAR_NETWORK ?? 'testnet';

/**
 * Print the transfer command and wait for the team account to hold the gas float.
 * @type {import('../services/team-seed.service.js').Fund}
 */
async function fund({ accountId, from, yocto }) {
  const amount = `${yocto / YOCTO_PER_NEAR} NEAR`;
  say(`\n${accountId} needs ${amount} for gas. Run this in another terminal:\n`);
  say(
    `  near tokens ${from} send-near ${accountId} '${amount}' network-config ${network} sign-with-legacy-keychain send\n`
  );
  say(`Waiting for the transfer (checking every ${POLL_MS / 1000} s) ...`);
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if ((await near.accountBalance(accountId)) >= yocto) {
      say(`${accountId} is funded.`);
      return;
    }
  }
}

let failed = false;
for (const def of defs) {
  try {
    const report = await seedTeam(def, { near, fund, log: say });
    say(
      report.skipped
        ? `${def.slug}: already seeded (${report.accountId})`
        : `${def.slug}: done, ${report.txs.length} transactions, ${near.explorerAccount(report.accountId)}`
    );
  } catch (err) {
    failed = true;
    if (err instanceof SeedBlockedError) {
      console.error(`\n${def.slug}: stopped. ${err.message}`);
      break;
    }
    console.error(`\n${def.slug}: failed.`, err);
    break;
  }
}
process.exit(failed ? 1 : 0);
