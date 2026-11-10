#!/usr/bin/env node
/**
 * Security demo (SPEC.md 14): plays a compromised agent with the rogue fixture's play key on
 * testnet and writes docs/security-demo.md from what the chain answered. Reads `.env.local`, the
 * database the fixture was seeded into (`npm run seed:teams -- testrogueagent`).
 *
 *   npm run attack:demo
 *
 * Each run spends up to the fixture's daily cap (1,000 Volts) on stat points, so it holds about
 * four runs of Volts and stat headroom. Exit 0 when every attempt ended as expected, else 1; the
 * report is written either way.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { getNear } from '../lib/near/index.js';
import { createKeyProbe } from '../lib/near/key-probe.js';
import { renderReport } from '../lib/security/attack-demo.js';

const { DemoNotReadyError, runAttackDemo } = await import('../services/attack-demo.service.js');

const REPORT = new URL('../docs/security-demo.md', import.meta.url);
/** The run as data, git-ignored, for a reader who wants the raw answers. */
const RUN_JSON = new URL('../tmp/security-demo-run.json', import.meta.url);

try {
  const run = await runAttackDemo({ near: getNear(), probe: createKeyProbe() });
  // Written as Prettier formats it, so the format check passes without a hand step.
  const path = fileURLToPath(REPORT);
  const options = { ...(await resolveConfig(path)), filepath: path };
  await writeFile(REPORT, await format(renderReport(run), options));
  await mkdir(new URL('.', RUN_JSON), { recursive: true });
  await writeFile(RUN_JSON, `${JSON.stringify(run, null, 2)}\n`);
  for (const a of run.attempts) {
    process.stdout.write(`${a.asExpected ? 'ok  ' : 'FAIL'} ${a.n}. ${a.title}\n`);
    for (const s of a.steps) {
      process.stdout.write(`       ${s.status} ${s.error ?? ''} ${s.txUrl ?? ''}\n`);
    }
  }
  process.stdout.write(`wrote docs/security-demo.md\n`);
  process.exit(run.attempts.every((a) => a.asExpected) ? 0 : 1);
} catch (err) {
  if (err instanceof DemoNotReadyError) {
    console.error(`not ready: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
