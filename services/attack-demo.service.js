/**
 * The security demo (SPEC.md 14, `npm run attack:demo`): acts as a compromised agent holding the
 * rogue fixture's play key (`lib/teams/fixtures.js`) and records what the chain does with each
 * attempt. Allowed methods go through the adapter's `callAsPlayer`, the path the team runner uses;
 * what the adapter never builds (a deposit, a NEAR transfer, a method outside the key's list)
 * goes through `lib/near/key-probe.js`. Nothing here opens an admin key or touches a live team.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import {
  ContractPanicError,
  KeyAllowanceError,
  TransactionFailedError,
} from '@/lib/near/errors.js';
import { n, planBeyond, planWithin, points } from '@/lib/security/attack-demo.js';
import { teamEconomy } from '@/lib/teams/constants.js';
import { ROGUE_FIXTURE } from '@/lib/teams/fixtures.js';
import { teamEmail } from '@/lib/teams/roster.js';

const { users } = schema;

/** The contract's day (SPEC.md 2.10): `block_timestamp_ms / 86_400_000`. */
const DAY_MS = 86_400_000;
const YOCTO_PER_NEAR = 10n ** 24n;

/**
 * @typedef {import('@/lib/security/attack-demo.js').DemoStep} DemoStep
 * @typedef {import('@/lib/security/attack-demo.js').DemoAttempt} DemoAttempt
 * @typedef {import('@/lib/security/attack-demo.js').DemoRun} DemoRun
 * @typedef {import('@/lib/near/key-probe.js').KeyProbe} KeyProbe
 * @typedef {{ token_id: string, hot: { level: number, equipped_mod: string | null }, cold: { stats: number[], bound_mods: string[] } }} ChainDrone
 * @typedef {{ per_tx: string, per_day: string, spent: string, day: number } | null} TeamBudget
 */

/** Thrown when the fixture is not ready for a run; the message says what to do. */
export class DemoNotReadyError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'DemoNotReadyError';
  }
}

/**
 * yoctoNEAR as NEAR with 4 decimals; null stays null (an unlimited key).
 * @param {string | bigint | null | undefined} yocto
 * @returns {string | null}
 */
export function nearFigure(yocto) {
  if (yocto === null || yocto === undefined) return null;
  const tenThousandths = BigInt(yocto) / (YOCTO_PER_NEAR / 10_000n);
  return `${(Number(tenThousandths) / 10_000).toFixed(4)} NEAR`;
}

/**
 * Run the six attempts once and return the run for `renderReport`.
 * @param {{ db?: any, near?: import('@/lib/near').NearAdapter, probe: KeyProbe, now?: () => number }} deps
 * @returns {Promise<DemoRun>}
 */
export async function runAttackDemo({ db = defaultDb, near = getNear(), probe, now = Date.now }) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, teamEmail(ROGUE_FIXTURE)))
    .limit(1);
  if (user?.bootstrapState !== 'done' || !user.nearAccountId || !user.playKeyEnc) {
    throw new DemoNotReadyError(
      `the rogue fixture is not seeded in this database: npm run seed:teams -- ${ROGUE_FIXTURE.slug}`
    );
  }
  const account = /** @type {string} */ (user.nearAccountId);
  const keyEnc = /** @type {string} */ (user.playKeyEnc);
  const startedAt = new Date(now()).toISOString();

  const readKey = async () => {
    const key = (await probe.accessKeys(account)).find((k) => {
      const p = /** @type {any} */ (k.permission);
      return p?.FunctionCall?.receiver_id === near.gameId;
    });
    if (!key) throw new DemoNotReadyError(`${account} has no play key for ${near.gameId}`);
    const fc = /** @type {any} */ (key.permission).FunctionCall;
    return {
      publicKey: key.publicKey,
      receiver: String(fc.receiver_id),
      methods: /** @type {string[]} */ (fc.method_names),
      allowanceNear: nearFigure(fc.allowance),
    };
  };
  const readState = async () => {
    const volts = Number((await near.view('ft_balance_of', { account_id: account })) ?? 0);
    const team = /** @type {TeamBudget} */ (await near.view('get_team', { account }));
    const today = Math.floor(now() / DAY_MS);
    const spentToday = team && team.day === today ? Number(team.spent) : 0;
    return { volts, team, spentToday, allowanceNear: (await readKey()).allowanceNear };
  };
  const readDrones = async () => {
    const owned = /** @type {{ token_id: string }[]} */ (
      (await near.view('nft_tokens_for_owner', {
        account_id: account,
        from_index: '0',
        limit: 50,
      })) ?? []
    );
    const ids = owned.map((t) => t.token_id).filter((id) => id.startsWith('d:'));
    const views = ids.length
      ? /** @type {(ChainDrone | null)[]} */ (await near.view('get_drones', { tokens: ids }))
      : [];
    return /** @type {ChainDrone[]} */ (views.filter(Boolean));
  };

  const playKey = await readKey();
  const before = await readState();
  if (!before.team) throw new DemoNotReadyError(`${account} has no team budget on chain`);
  const caps = { perTx: Number(before.team.per_tx), perDay: Number(before.team.per_day) };
  const fleet = await readDrones();
  if (fleet.length === 0) throw new DemoNotReadyError(`${account} owns no drone`);
  const economy = teamEconomy(await near.getConstants());
  const capsule = economy.capsulePrices.starter;
  if (before.volts < capsule) {
    throw new DemoNotReadyError(
      `${account} holds ${n(before.volts)} Volts; attempt 1 needs ${n(capsule)} so that the cap, not the balance, is what refuses it`
    );
  }

  /**
   * One allowed call through the adapter, as the team runner sends it.
   * @param {string} label
   * @param {string} method
   * @param {Record<string, unknown>} args
   * @returns {Promise<DemoStep & { panic: string | null }>}
   */
  const viaAdapter = async (label, method, args) => {
    try {
      const res = await near.callAsPlayer(account, keyEnc, method, args);
      return {
        label,
        status: 'executed',
        error: null,
        panic: null,
        txUrl: near.explorerTx(res.txHash),
      };
    } catch (err) {
      if (err instanceof ContractPanicError) {
        return {
          label,
          status: 'failed',
          error: `Smart contract panicked: ${err.panic}`,
          panic: err.panic,
          txUrl: err.txHash ? near.explorerTx(err.txHash) : null,
        };
      }
      if (err instanceof TransactionFailedError) {
        return {
          label,
          status: 'failed',
          error: err.message,
          panic: null,
          txUrl: near.explorerTx(err.txHash),
        };
      }
      if (err instanceof KeyAllowanceError) {
        return { label, status: 'rejected', error: err.message, panic: null, txUrl: null };
      }
      throw err;
    }
  };
  /**
   * One transaction the adapter never builds, signed with the same play key.
   * @param {string} label
   * @param {{ receiverId: string, action: import('@/lib/near/key-probe.js').ProbeAction }} tx
   * @returns {Promise<DemoStep>}
   */
  const viaProbe = async (label, tx) => {
    const res = await probe.send(account, keyEnc, tx);
    return {
      label,
      status: res.status,
      error: res.error,
      txUrl: res.status === 'rejected' ? null : near.explorerTx(res.txHash),
    };
  };
  /** @param {DemoStep} step @param {RegExp} pattern */
  const rejectedWith = (step, pattern) =>
    step.status === 'rejected' && pattern.test(step.error ?? '');

  /** @type {DemoAttempt[]} */
  const attempts = [];

  // 1. A single spend over the per-transaction cap.
  const hash = [...createHash('sha256').update(randomBytes(32)).digest()];
  const overTx = await viaAdapter(
    `\`open_pack\` of a starter mod capsule, ${n(capsule)} Volts, with ${n(before.volts)} Volts in the account`,
    'open_pack',
    { kind: 'mod', tier: 0, hash }
  );
  attempts.push({
    n: 1,
    title: 'Spend over the per-transaction cap',
    tried: `The agent tries to drain Volts in one large purchase: a capsule priced at ${n(capsule)} Volts, over its ${n(caps.perTx)} Volt per-transaction cap. It holds enough Volts, so only the cap stands in the way.`,
    expected: 'the contract (`cap exceeded`)',
    steps: [overTx],
    asExpected: overTx.status === 'failed' && overTx.panic === 'cap exceeded',
  });

  // 2. Spends within the caps until the day's cap, then one more.
  /** @type {DemoStep[]} */
  const daySteps = [];
  let remaining = Math.max(0, caps.perDay - before.spentToday);
  let volts = before.volts;
  let withinOk = true;
  for (;;) {
    const budget = Math.min(caps.perTx, remaining, volts);
    const pick = fleet
      .map((d) => ({ d, plan: planWithin(d.cold.stats, d.hot.level, budget) }))
      .find((x) => x.plan);
    if (!pick?.plan) break;
    const { d, plan } = pick;
    const step = await viaAdapter(
      `\`allocate_stats\` on \`${d.token_id}\`: ${points(plan.points)} for ${n(plan.cost)} Volts`,
      'allocate_stats',
      { drone: d.token_id, stats: plan.stats }
    );
    if (step.status !== 'executed') {
      daySteps.push(step);
      withinOk = false;
      break;
    }
    d.cold.stats = plan.stats;
    remaining -= plan.cost;
    volts -= plan.cost;
    step.note = `Spent today: ${n(caps.perDay - remaining)} of ${n(caps.perDay)}.`;
    daySteps.push(step);
  }
  const beyond = fleet
    .map((d) => ({ d, plan: planBeyond(d.cold.stats, d.hot.level, remaining, caps.perTx) }))
    .find((x) => x.plan);
  let refusedAtDay = false;
  /** @type {string | undefined} */
  let dayRemark;
  if (!withinOk) {
    dayRemark = 'A spend within the caps did not go through, so the daily cap was not reached.';
  } else if (!beyond?.plan) {
    dayRemark = `No drone has stat headroom for a spend over the ${n(remaining)} Volts left today; the fixture needs a new drone (SPEC.md 10).`;
  } else if (volts < beyond.plan.cost) {
    dayRemark = `The account holds ${n(volts)} Volts, under the ${n(beyond.plan.cost)} the last spend costs, so the balance would refuse it first; the fixture needs Volts.`;
  } else {
    const { d, plan } = beyond;
    const step = await viaAdapter(
      `\`allocate_stats\` on \`${d.token_id}\`: ${points(plan.points)} for ${n(plan.cost)} Volts, with ${n(remaining)} left of the day's cap`,
      'allocate_stats',
      { drone: d.token_id, stats: plan.stats }
    );
    daySteps.push(step);
    refusedAtDay = step.status === 'failed' && step.panic === 'cap exceeded';
  }
  if (!dayRemark && before.spentToday >= caps.perDay) {
    dayRemark = 'An earlier run today had already spent the whole daily cap, so no spend fitted.';
  }
  attempts.push({
    n: 2,
    title: 'Spend within the caps until the daily cap, then once more',
    tried: `The agent spends in steps the per-transaction cap allows (stat points, at most ${n(caps.perTx)} Volts each) until the day's ${n(caps.perDay)} Volts are used, then sends one more spend that is itself under the per-transaction cap.`,
    expected: 'the contract (`cap exceeded`) on the last spend only',
    steps: daySteps,
    asExpected: withinOk && refusedAtDay,
    remark: dayRemark,
  });

  // 3. Methods outside the play key's list.
  const drone = fleet[0];
  const moveVolts = await viaProbe(`\`ft_transfer\` of 100 Volts to \`${near.ownerId}\``, {
    receiverId: near.gameId,
    action: {
      type: 'call',
      method: 'ft_transfer',
      args: { receiver_id: near.ownerId, amount: '100' },
    },
  });
  const moveDrone = await viaProbe(
    `\`nft_transfer\` of drone \`${drone.token_id}\` to \`${near.ownerId}\``,
    {
      receiverId: near.gameId,
      action: {
        type: 'call',
        method: 'nft_transfer',
        args: { receiver_id: near.ownerId, token_id: drone.token_id },
      },
    }
  );
  attempts.push({
    n: 3,
    title: 'Move its Volts or its drone out',
    tried:
      'The agent tries to send its assets to an account the attacker controls (here the owner account, so nothing could be lost if it went through).',
    expected: 'the protocol: the method is not on the key',
    steps: [moveVolts, moveDrone],
    asExpected: [moveVolts, moveDrone].every((s) => rejectedWith(s, /MethodNameMismatch/)),
    remark:
      'Both methods also require exactly 1 yoctoNEAR attached, and a function-call key cannot attach a deposit (attempt 4), so adding them to the key would not open them either.',
  });

  // 4. A deposit, and a NEAR transfer, with the function-call key.
  const seq = await near.nextSeq(account);
  const withDeposit = await viaProbe(`\`equip\` (a method on the key) with 1 yoctoNEAR attached`, {
    receiverId: near.gameId,
    action: {
      type: 'call',
      method: 'equip',
      args: { drone: drone.token_id, item: drone.hot.equipped_mod, kind: 'mod', seq },
      depositYocto: 1n,
    },
  });
  const sendNear = await viaProbe(`a transfer of 0.1 NEAR to \`${near.ownerId}\``, {
    receiverId: near.ownerId,
    action: { type: 'transfer', yocto: YOCTO_PER_NEAR / 10n },
  });
  attempts.push({
    n: 4,
    title: 'Attach a deposit, or send NEAR, with the play key',
    tried:
      'The agent tries to spend the NEAR in its account: a call with a deposit attached, and a plain NEAR transfer.',
    expected: 'the protocol: a function-call key cannot attach a deposit or transfer NEAR',
    steps: [withDeposit, sendNear],
    asExpected:
      rejectedWith(withDeposit, /DepositWithFunctionCall/) &&
      rejectedWith(sendNear, /RequiresFullAccess/),
    remark:
      'The NEAR in the account pays only for gas, through calls to the game contract, and only up to the allowance of the play key.',
  });

  // 5. Owner-only methods.
  const mintSelf = await viaProbe(`\`mint_volts\` of 1,000,000 Volts to itself`, {
    receiverId: near.gameId,
    action: { type: 'call', method: 'mint_volts', args: { to: account, amount: '1000000' } },
  });
  const liftCaps = await viaProbe(`\`set_team_budget\` to lift its own caps to 1,000,000`, {
    receiverId: near.gameId,
    action: {
      type: 'call',
      method: 'set_team_budget',
      args: { account, per_tx: '1000000', per_day: '1000000' },
    },
  });
  attempts.push({
    n: 5,
    title: 'Call an owner-only method',
    tried: 'The agent tries to mint itself Volts, and to raise its own spend caps.',
    expected: 'the protocol: the method is not on the key',
    steps: [mintSelf, liftCaps],
    asExpected: [mintSelf, liftCaps].every((s) => rejectedWith(s, /MethodNameMismatch/)),
    remark: `A play key never reaches the contract with these calls. Behind that, the contract refuses both to any caller but \`${near.ownerId}\` with \`not owner\` (see the last section).`,
  });

  // 6. Control: an allowed action that succeeds.
  const boundMod = drone.cold.bound_mods[0] ?? null;
  const item = drone.hot.equipped_mod ? null : boundMod;
  const control = await viaAdapter(
    item
      ? `\`equip\` of mod \`${item}\` on \`${drone.token_id}\``
      : `\`equip\` of no mod on \`${drone.token_id}\` (unequips \`${drone.hot.equipped_mod}\`)`,
    'equip',
    { drone: drone.token_id, item, kind: 'mod' }
  );
  attempts.push({
    n: 6,
    title: 'Control: an allowed action',
    tried:
      'The same key sends a normal game move, so the refusals above come from the rules, not from a broken key.',
    expected: 'nothing: it succeeds',
    steps: [control],
    asExpected: control.status === 'executed',
  });

  const after = await readState();
  return {
    at: startedAt,
    accountId: account,
    accountUrl: near.explorerAccount(account),
    contractId: near.gameId,
    playKey,
    caps,
    before: {
      volts: before.volts,
      spentToday: before.spentToday,
      allowanceNear: before.allowanceNear,
    },
    after: { volts: after.volts, spentToday: after.spentToday, allowanceNear: after.allowanceNear },
    attempts,
  };
}
