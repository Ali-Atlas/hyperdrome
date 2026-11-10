/**
 * Pure parts of the security demo (SPEC.md 14, `npm run attack:demo`): planning the stat points a
 * rogue agent buys to walk its daily cap, and writing `docs/security-demo.md` from a run.
 */
import {
  calculatePerStatCap,
  calculateStatUpgradeCost,
  calculateTSB,
} from '@/lib/game-engine/economy.js';

/**
 * @typedef {{ stats: number[], cost: number, points: number }} SpendPlan new stats for
 *   `allocate_stats`, what they cost and how many points they add
 * @typedef {object} DemoStep one transaction (or one refused send) of an attempt
 * @property {string} label what was sent
 * @property {'executed' | 'failed' | 'rejected'} status as in `lib/near/key-probe.js`
 * @property {string | null} error the exact error, null when it executed
 * @property {string | null} txUrl the explorer link; null when the RPC refused it before any block
 * @property {string} [note] what changed, in plain words
 * @typedef {object} DemoAttempt
 * @property {number} n 1 to 6, in the brief's order
 * @property {string} title
 * @property {string} tried what the rogue agent tries, and why it would want to
 * @property {string} expected which layer should stop it
 * @property {DemoStep[]} steps
 * @property {boolean} asExpected every step ended as `expected` says
 * @property {string} [remark] a fact the reader needs next to the result
 * @typedef {object} DemoRun
 * @property {string} at ISO time the run started
 * @property {string} accountId
 * @property {string} accountUrl
 * @property {string} contractId
 * @property {{ publicKey: string, receiver: string, methods: string[], allowanceNear: string | null }} playKey
 * @property {{ perTx: number, perDay: number }} caps
 * @property {{ volts: number, spentToday: number, allowanceNear: string | null }} before
 * @property {{ volts: number, spentToday: number, allowanceNear: string | null }} after
 * @property {DemoAttempt[]} attempts
 */

/** @param {number} value a whole number with thousands separators: `1,000` */
export const n = (value) => value.toLocaleString('en-US');

/** @param {number} count `1 stat point`, `94 stat points` */
export const points = (count) => `${n(count)} stat point${count === 1 ? '' : 's'}`;

/**
 * The next stat point to buy: the highest stat still under its cap (ties: 2.1 order), so each
 * point costs as much as it can and a drone's headroom covers as many demo runs as possible.
 * Null when the drone is at TSB or every stat is at cap.
 * @param {number[]} stats
 * @param {number} level
 * @returns {{ index: number, cost: number } | null}
 */
function nextPoint(stats, level) {
  if (stats.reduce((a, b) => a + b, 0) >= calculateTSB(level)) return null;
  const cap = calculatePerStatCap(level);
  let best = -1;
  stats.forEach((value, i) => {
    if (value < cap && (best < 0 || value > stats[best])) best = i;
  });
  return best < 0 ? null : { index: best, cost: calculateStatUpgradeCost(stats[best]) };
}

/**
 * Points that cost at most `budget` in total, as many as fit. Null when not one point fits.
 * @param {number[]} stats on-chain stats, 2.1 order
 * @param {number} level
 * @param {number} budget
 * @returns {SpendPlan | null}
 */
export function planWithin(stats, level, budget) {
  const next = [...stats];
  let cost = 0;
  let points = 0;
  for (let p = nextPoint(next, level); p && cost + p.cost <= budget; p = nextPoint(next, level)) {
    next[p.index] += 1;
    cost += p.cost;
    points += 1;
  }
  return points > 0 ? { stats: next, cost, points } : null;
}

/**
 * The fewest points whose cost passes `remaining` (what is left of the day's cap) while staying
 * within `perTx`, so the only rule the spend breaks is the daily cap. Null when the drone has no
 * such points.
 * @param {number[]} stats
 * @param {number} level
 * @param {number} remaining
 * @param {number} perTx
 * @returns {SpendPlan | null}
 */
export function planBeyond(stats, level, remaining, perTx) {
  const next = [...stats];
  let cost = 0;
  let points = 0;
  while (cost <= remaining) {
    const p = nextPoint(next, level);
    if (!p || cost + p.cost > perTx) return null;
    next[p.index] += 1;
    cost += p.cost;
    points += 1;
  }
  return { stats: next, cost, points };
}

/** @param {DemoStep} step */
function stepLines(step) {
  const where = step.txUrl
    ? `[transaction](${step.txUrl})`
    : step.status === 'rejected'
      ? 'no transaction: the RPC refused it before any block, so it never reached the chain'
      : 'no link';
  const outcome =
    step.status === 'executed' ? 'succeeded' : step.status === 'failed' ? 'failed' : 'rejected';
  return [
    `- ${step.label}: ${outcome}, ${where}.${step.note ? ` ${step.note}` : ''}`,
    ...(step.error ? ['', '  ```', `  ${step.error}`, '  ```'] : []),
  ];
}

/**
 * `docs/security-demo.md` for a run.
 * @param {DemoRun} run
 * @returns {string}
 */
export function renderReport(run) {
  const allowance = (/** @type {string | null} */ a) => a ?? 'unlimited';
  const lines = [
    '# Security demo: a compromised agent on testnet',
    '',
    'Generated by `npm run attack:demo` ([scripts/attack-demo.mjs](../scripts/attack-demo.mjs)). Do not edit by hand; run the script again.',
    '',
    'The AI teams are rule-based, so this demo assumes the worst case for one of them: its play key is stolen, or its logic is hijacked and sends whatever the attacker wants. The agent below is a test fixture built like a team (same account type, same key scope, on-chain caps), never one of the four live teams. Every attempt is a real transaction on testnet where the chain accepts one; the RPC refuses some before any block, and those have no link.',
    '',
    `- Run: ${run.at}`,
    `- Agent account: [${run.accountId}](${run.accountUrl}), created by \`${run.contractId}\` with \`create_player\``,
    `- Its play key: \`${run.playKey.publicKey}\`, a function-call key for \`${run.playKey.receiver}\`, methods ${run.playKey.methods.map((m) => `\`${m}\``).join(', ')}, gas allowance ${allowance(run.playKey.allowanceNear)}`,
    `- On-chain caps (\`get_team\`): ${n(run.caps.perTx)} Volts per transaction, ${n(run.caps.perDay)} per day`,
    `- Before: ${n(run.before.volts)} Volts, ${n(run.before.spentToday)} spent today, key allowance ${allowance(run.before.allowanceNear)}`,
    `- After: ${n(run.after.volts)} Volts, ${n(run.after.spentToday)} spent today, key allowance ${allowance(run.after.allowanceNear)}`,
    '',
    '| # | Attempt | Stopped by | As expected |',
    '| - | ------- | ---------- | ----------- |',
    ...run.attempts.map(
      (a) => `| ${a.n} | ${a.title} | ${a.expected} | ${a.asExpected ? 'yes' : 'no'} |`
    ),
  ];
  for (const a of run.attempts) {
    lines.push('', `## ${a.n}. ${a.title}`, '', a.tried, '', `Expected: ${a.expected}.`, '');
    for (const step of a.steps) lines.push(...stepLines(step));
    if (a.remark) lines.push('', a.remark);
  }
  lines.push(
    '',
    '## What this does not cover',
    '',
    'A compromised server is a larger attacker than a stolen play key: it holds the sealed admin full-access key of every account and the key that opens it (SPEC.md 14). The contract still refuses its owner-only methods to any caller but the owner account; that check is in the sandbox test `init_metadata_constants_and_owner_access`, which calls `mint_volts`, `mint_drone`, `set_team_budget` and the other owner methods from a stranger account and expects `not owner`, in [contracts/hyperdrome/tests/sandbox.rs](../contracts/hyperdrome/tests/sandbox.rs). This demo signs only with the play key.',
    ''
  );
  return lines.join('\n');
}
