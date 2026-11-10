/**
 * Seeding of an AI team (SPEC.md 2.10, 10), used by `scripts/seed-teams.mjs`. A team is a users
 * row with `is_team`, a NEAR account `<slug>.<game contract>`, a `teams` row (persona weights and
 * reserve), an on-chain budget, three drones with skins and mods, and Volts. The users row's
 * `bootstrap_state` records progress (`none -> account -> minted -> done`) and every step reads
 * the chain or the row first, so the script can be run again after any failure and a finished
 * team is skipped. One run at a time: there is no lease, the operator runs the script.
 */
import { and, eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import {
  AccountCreateError,
  ContractPanicError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
} from '@/lib/near/errors.js';
import { teamEconomy } from '@/lib/teams/constants.js';
import { TEAM_DRONE_LEVELS, TEAM_GAS_YOCTO } from '@/lib/teams/roster.js';
import { SeedBlockedError, bindKit, cacheKit, ledgerOf, mintKit } from './team-seed-kit.js';

export { SeedBlockedError };

const { users, teams } = schema;

/** The owner account must hold at least this much (yoctoNEAR) before a gas transfer is asked for. */
export const MIN_OWNER_YOCTO = 10n * 10n ** 24n;

/**
 * @typedef {import('@/lib/teams/roster.js').TeamDef} TeamDef
 * @typedef {typeof users.$inferSelect} UserRow
 * @typedef {import('@/lib/near').CreateAttempt} PendingCreate
 * @typedef {(request: { accountId: string, from: string, yocto: bigint }) => Promise<void>} Fund
 *   asks the operator to send the gas float from the owner account (full-access key, command line
 *   only) and resolves when it has arrived
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter, fund?: Fund, log?: (line: string) => void, reconcile?: boolean }} Deps
 *   `reconcile`: bring a finished team's kit up to the roster (see `seedTeam`)
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, def: TeamDef, fund?: Fund, record: (step: string, txHash: string) => void, txs: { step: string, txHash: string }[] }} Ctx
 * @typedef {{ team: string, accountId: string, skipped: boolean, txs: { step: string, txHash: string }[] }} SeedReport
 */

/**
 * Seed one team, or finish a seed that stopped part way. Sends nothing for a finished team, unless
 * `reconcile` is set: then the roster's drones, skins and mods the team does not have yet are
 * minted and bound (after a roster change). A reconcile never mints Volts, funds gas or rotates
 * the key, and nothing a team already owns is removed (binds are permanent).
 * @param {TeamDef} def
 * @param {Deps} [deps]
 * @returns {Promise<SeedReport>}
 */
export async function seedTeam(def, deps = {}) {
  const near = deps.near ?? getNear();
  /** @type {Ctx['txs']} */
  const txs = [];
  /** @type {Ctx} */
  const ctx = {
    db: deps.db ?? defaultDb,
    near,
    def,
    fund: deps.fund,
    txs,
    record: (step, txHash) => {
      txs.push({ step, txHash });
      deps.log?.(`${def.slug}: ${step} ${near.explorerTx(txHash)}`);
    },
  };
  let user = await ensureUser(ctx);
  if (user.bootstrapState === 'done') {
    if (!deps.reconcile) return report(ctx, user, true);
    // Back to `account` with the Volts marked as granted; the kit steps below do the rest.
    const ledger = { minted: { volts: 'kept' }, unknown: [] };
    user = await advance(ctx, 'done', { bootstrapState: 'account', bootstrapPending: ledger });
  }

  const economy = seedEconomy(def, await near.getConstants());
  if (!def.fixture && economy.droneLevels.join() !== TEAM_DRONE_LEVELS.join()) {
    throw new Error(`contract team drone levels ${economy.droneLevels} differ from the roster`);
  }
  if (user.bootstrapState === 'none') user = await createAccount(ctx, user);
  const owner = /** @type {string} */ (user.nearAccountId);
  // From here on `bootstrap_pending` holds the mint ledger (services/team-seed-kit.js).
  const ledger = ledgerOf(user.bootstrapPending);
  const kit = {
    ...ctx,
    owner,
    ledger,
    saveLedger: () =>
      ctx.db.update(users).set({ bootstrapPending: ledger }).where(eq(users.id, user.id)),
  };

  if (user.bootstrapState === 'account') {
    await ensureBudget(ctx, owner, economy);
    await mintKit(kit, economy.startVolts);
    user = await advance(ctx, 'account', { bootstrapState: 'minted' });
  }
  await bindKit(kit, /** @type {string} */ (user.playKeyEnc));
  await cacheKit(kit);
  // A fixture gets no `teams` row, so the team phase never runs it (SPEC.md 10).
  if (!def.fixture) {
    await ctx.db
      .insert(teams)
      .values({
        userId: user.id,
        name: def.name,
        persona: def.weights,
        reserve: String(economy.reserve),
      })
      .onConflictDoUpdate({
        target: teams.userId,
        set: { name: def.name, persona: def.weights, reserve: String(economy.reserve) },
      });
  }
  user = await fundAndRotate(ctx, user);
  const points = Number((await near.view('ft_balance_of', { account_id: owner })) ?? 0);
  user = await advance(ctx, 'minted', { bootstrapState: 'done', points, bootstrapPending: null });
  return report(ctx, user, false);
}

/**
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @param {boolean} skipped
 * @returns {SeedReport}
 */
const report = (ctx, user, skipped) => ({
  team: ctx.def.slug,
  accountId: /** @type {string} */ (user.nearAccountId),
  skipped,
  txs: ctx.txs,
});

/**
 * The contract's team economy, with a fixture's own caps and start Volts in place of the team ones.
 * @param {TeamDef} def
 * @param {unknown} constants the `get_constants()` result
 * @returns {import('@/lib/teams/constants.js').TeamEconomy}
 */
function seedEconomy(def, constants) {
  const economy = teamEconomy(constants);
  if (!def.fixture) return economy;
  const { perTxCap, perDayCap, startVolts } = def.fixture;
  return { ...economy, perTxCap, perDayCap, startVolts };
}

/** @param {TeamDef} def the team's users.email (teams never sign in; `.invalid` never resolves) */
export const teamEmail = (def) => `${def.slug}@teams.hyperdrome.invalid`;

/**
 * The team's users row, created on the first run.
 * @param {Ctx} ctx
 * @returns {Promise<UserRow>}
 */
async function ensureUser(ctx) {
  const email = teamEmail(ctx.def);
  await ctx.db
    .insert(users)
    .values({ email, username: ctx.def.name, name: ctx.def.name, isTeam: true })
    .onConflictDoNothing({ target: users.email });
  const [row] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row?.isTeam) throw new Error(`users row ${email} is missing or is not a team`);
  return row;
}

/**
 * Move the team's row from `from` with `set`.
 * @param {Ctx} ctx
 * @param {'none' | 'account' | 'minted' | 'done'} from
 * @param {Partial<UserRow>} set
 * @returns {Promise<UserRow>}
 */
async function advance(ctx, from, set) {
  const [row] = await ctx.db
    .update(users)
    .set(set)
    .where(and(eq(users.email, teamEmail(ctx.def)), eq(users.bootstrapState, from)))
    .returning();
  if (!row) throw new Error(`team ${ctx.def.slug} left state ${from} under another run`);
  return row;
}

/**
 * `none -> account`: create `<slug>.<game>` with `create_player`. A team's account name can be
 * created only once, so the sealed keys and the transaction hash of every attempt are stored in
 * `bootstrap_pending` before the transaction is broadcast. Whatever happens after (a lost answer,
 * a killed process, a failed write), the next run finds the attempt that created the account.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @returns {Promise<UserRow>}
 */
async function createAccount(ctx, user) {
  const { near, def } = ctx;
  let attempts = /** @type {PendingCreate[]} */ (user.bootstrapPending ?? []);
  /** @param {PendingCreate[]} next */
  const store = async (next) => {
    attempts = next;
    await advance(ctx, 'none', { bootstrapPending: next.length > 0 ? next : null });
  };
  for (const attempt of [...attempts]) {
    const outcome = await resolveCreate(ctx, attempt);
    if (outcome === 'created') {
      ctx.record(`create_player ${attempt.accountId} (resolved)`, attempt.txHash);
      return storeKeys(ctx, attempt);
    }
    if (outcome === 'failed') await store(attempts.filter((a) => a !== attempt));
  }
  const earlier = attempts.length;
  try {
    const created = await near.createPlayerAccount({
      slug: def.slug,
      isTeam: true,
      onSigned: (attempt) => store([...attempts, attempt]),
    });
    ctx.record(`create_player ${created.accountId}`, created.txHash);
    return await storeKeys(ctx, created);
  } catch (err) {
    if (err instanceof ContractPanicError && err.panic === 'exists') {
      throw new SeedBlockedError(
        earlier > 0
          ? `${def.slug} exists on chain and an earlier create has no outcome yet; its keys are in bootstrap_pending. Run the script again in a minute.`
          : `${def.slug} exists on chain but this database holds no keys for it.`
      );
    }
    if (err instanceof ContractPanicError || err instanceof AccountCreateError) throw err;
    throw new SeedBlockedError(
      `create_player for ${def.slug} returned no outcome (${String(err)}); its keys are stored. Run the script again in a minute.`
    );
  }
}

/**
 * What became of a stored create attempt: `created` (it executed and made the account), `failed`
 * (it executed and did not), or `unknown` (the chain does not show it yet).
 * @param {Ctx} ctx
 * @param {PendingCreate} attempt
 * @returns {Promise<'created' | 'failed' | 'unknown'>}
 */
async function resolveCreate(ctx, attempt) {
  try {
    const outcome = await ctx.near.resolveOutcome(attempt.accountId, 0, attempt.txHash, {
      senderId: ctx.near.ownerId,
    });
    if (!outcome.applied) return 'unknown';
    return outcome.result === true ? 'created' : 'failed';
  } catch (err) {
    if (err instanceof ContractPanicError || err instanceof TransactionFailedError) return 'failed';
    throw err;
  }
}

/**
 * @param {Ctx} ctx
 * @param {{ accountId: string, playKeyEnc: string, adminKeyEnc: string, keyVersion: number }} keys
 */
function storeKeys(ctx, keys) {
  return advance(ctx, 'none', {
    nearAccountId: keys.accountId,
    playKeyEnc: keys.playKeyEnc,
    adminKeyEnc: keys.adminKeyEnc,
    keyVersion: keys.keyVersion,
    bootstrapPending: null,
    bootstrapState: 'account',
  });
}

/**
 * `set_team_budget` with the contract's caps, unless the team's budget already has them.
 * @param {Ctx} ctx
 * @param {string} owner
 * @param {import('@/lib/teams/constants.js').TeamEconomy} economy
 */
async function ensureBudget(ctx, owner, economy) {
  const budget = /** @type {{ per_tx: string, per_day: string } | null} */ (
    await ctx.near.view('get_team', { account: owner })
  );
  const perTx = String(economy.perTxCap);
  const perDay = String(economy.perDayCap);
  if (budget?.per_tx === perTx && budget?.per_day === perDay) return;
  const res = await ctx.near.callAsOps('set_team_budget', {
    account: owner,
    per_tx: perTx,
    per_day: perDay,
  });
  ctx.record(`set_team_budget ${perTx} per tx, ${perDay} per day`, res.txHash);
}

/**
 * Gas: the team account gets its 2 NEAR float from the owner account (the operator sends it from
 * the command line; this code never holds that key), then its play key is rotated to a 2 NEAR
 * allowance; a fixture uses its own `gasYocto` for both. A rotated key (`key_version` above 1)
 * means both are done.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @returns {Promise<UserRow>}
 */
async function fundAndRotate(ctx, user) {
  const { near, def } = ctx;
  const owner = /** @type {string} */ (user.nearAccountId);
  if ((user.keyVersion ?? 1) > 1) return user;
  const gas = def.fixture?.gasYocto ?? TEAM_GAS_YOCTO;
  const gasNear = nearText(gas);
  if ((await near.accountBalance(owner)) < gas) {
    if ((await near.accountBalance(near.ownerId)) < MIN_OWNER_YOCTO) {
      throw new SeedBlockedError(
        `${near.ownerId} holds under 10 NEAR; fund it before sending ${def.slug} its gas. Run the script again after.`
      );
    }
    if (!ctx.fund) throw new SeedBlockedError(`${owner} needs its ${gasNear} gas float.`);
    await ctx.fund({ accountId: owner, from: near.ownerId, yocto: gas });
    if ((await near.accountBalance(owner)) < gas) {
      throw new SeedBlockedError(`${owner} still holds under ${gasNear}. Run the script again.`);
    }
  }
  let rotated;
  try {
    rotated = await near.rotatePlayKey(owner, /** @type {string} */ (user.adminKeyEnc), {
      keyVersion: user.keyVersion ?? 1,
      allowance: gas,
    });
  } catch (err) {
    if (!(err instanceof RpcUnknownOutcomeError)) throw err;
    // Rotating again is safe: it deletes whichever play key is on the account and adds a new one.
    throw new SeedBlockedError(
      `the play key rotation of ${def.slug} has an unknown outcome (tx ${err.txHash}). Run the script again.`
    );
  }
  ctx.record(
    `rotatePlayKey to a ${gasNear} allowance (key version ${rotated.keyVersion})`,
    rotated.txHash
  );
  return advance(ctx, 'minted', {
    playKeyEnc: rotated.playKeyEnc,
    keyVersion: rotated.keyVersion,
  });
}

/**
 * yoctoNEAR as text, for messages: `2 NEAR`, `0.5 NEAR`.
 * @param {bigint} yocto
 */
export function nearText(yocto) {
  const unit = 10n ** 24n;
  const fraction = (yocto % unit).toString().padStart(24, '0').replace(/0+$/, '');
  return `${yocto / unit}${fraction ? `.${fraction}` : ''} NEAR`;
}
