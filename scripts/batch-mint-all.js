/**
 * Sequential runner for the three batch-mint scripts.
 *
 *   node --env-file=.env.local scripts/batch-mint-all.js          # local DB
 *   node --env-file=.env.local scripts/batch-mint-all.js --prod   # prod DB
 *
 * Spawns each child with `stdio: 'inherit'` so per-row progress logs from
 * the underlying scripts (probe results, mint OK/FAIL lines, per-script
 * summary blocks) flow straight to the operator's terminal in real time.
 *
 * Phases run in dependency order:
 *
 *   1. drones - HyperdromeDrone NFTs first because some skin / mod
 *      bindings carry a `bound_drone_token_id` attribute on the
 *      metadata route, and that's only meaningful when the drone has
 *      a tokenId.
 *   2. skins  - HyperdromeSkin NFTs.
 *   3. mods   - HyperdromeMod NFTs.
 *
 * On a per-phase failure the runner DOES NOT abort - it logs the
 * failure and continues to the next phase, then exits non-zero at the
 * end if any phase failed. Operator typically wants to see "drones ok,
 * skins failed, mods ok" rather than stop at the first error and have
 * to re-run from scratch.
 *
 * `--prod` is forwarded to each child verbatim. The chain-side env
 * (DEPLOYER_PRIVATE_KEY, contract addresses, MEGAETH_RPC_URL) is the
 * same in both modes; the flag only retargets the DB URL the children
 * read from / write back to.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_PROD = process.argv.includes('--prod');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PHASES = ['drones', 'skins', 'mods'];

function runPhase(phase) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, `batch-mint-${phase}.js`);
    const args = [scriptPath];
    if (IS_PROD) args.push('--prod');
    // Children inherit process.env, which the parent already populated
    // via --env-file=.env.local at boot. No need to re-pass --env-file.
    const proc = spawn(process.execPath, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    proc.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `batch-mint-${phase} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
          ),
        );
      }
    });
    proc.on('error', reject);
  });
}

function bar() {
  console.log('='.repeat(60));
}

async function main() {
  bar();
  console.log(`[batch-mint-all] mode=${IS_PROD ? 'PROD' : 'local'} phases=${PHASES.join(', ')}`);
  bar();
  console.log('');

  const results = [];
  const overallStart = Date.now();

  for (const phase of PHASES) {
    bar();
    console.log(`[batch-mint-all] PHASE START: ${phase}`);
    bar();
    const start = Date.now();
    try {
      await runPhase(phase);
      const ms = Date.now() - start;
      console.log('');
      console.log(`[batch-mint-all] PHASE OK: ${phase} (${(ms / 1000).toFixed(1)}s)`);
      results.push({ phase, ok: true, ms });
    } catch (err) {
      const ms = Date.now() - start;
      console.error('');
      console.error(`[batch-mint-all] PHASE FAILED: ${phase} (${(ms / 1000).toFixed(1)}s) - ${err.message}`);
      results.push({ phase, ok: false, ms, error: err.message });
    }
    console.log('');
  }

  const overallMs = Date.now() - overallStart;

  bar();
  console.log('[batch-mint-all] SUMMARY');
  bar();
  for (const r of results) {
    const status = r.ok ? 'OK  ' : 'FAIL';
    console.log(`  ${status}  ${r.phase.padEnd(7)} ${(r.ms / 1000).toFixed(1)}s${r.error ? `  - ${r.error}` : ''}`);
  }
  console.log('');
  console.log(`  total: ${(overallMs / 1000).toFixed(1)}s`);

  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.error('');
    console.error(`[batch-mint-all] ${failed} of ${results.length} phase(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[batch-mint-all] fatal:', err);
  process.exit(1);
});
