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
  ContractPanicError,
  RpcUnknownOutcomeError,
  TransactionFailedError,
} from '@/lib/near/errors.js';
import { teamEconomy } from '@/lib/teams/constants.js';
import { TEAM_DRONE_LEVELS, TEAM_GAS_YOCTO } from '@/lib/teams/roster.js';
import { bindKit, cacheKit, mintKit } from './team-seed-kit.js';

const { users, teams } = schema;

/** The owner account must hold at least this much (yoctoNEAR) before a gas transfer is asked for. */
export const MIN_OWNER_YOCTO = 10n * 10n ** 24n;

/** Thrown when a step needs the operator: the message says what to do; running again resumes. */
export class SeedBlockedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SeedBlockedError';
  }
}

/**
 * @typedef {import('@/lib/teams/roster.js').TeamDef} TeamDef
 * @typedef {typeof users.$inferSelect} UserRow
 * @typedef {{ accountId: string, playKeyEnc: string, adminKeyEnc: string, keyVersion: number, txHash: string }} PendingCreate
 * @typedef {(request: { accountId: string, from: string, yocto: bigint }) => Promise<void>} Fund
 *   asks the operator to send the gas float from the owner account (full-access key, command line
 *   only) and resolves when it has arrived
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter, fund?: Fund, log?: (line: string) => void }} Deps
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, def: TeamDef, fund?: Fund, record: (step: string, txHash: string) => void, txs: { step: string, txHash: string }[] }} Ctx
 * @typedef {{ team: string, accountId: string, skipped: boolean, txs: { step: string, txHash: string }[] }} SeedReport
 */

/**
 * Seed one team, or finish a seed that stopped part way. Sends nothing for a finished team.
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
  const economy = teamEconomy(await near.getConstants());
  if (economy.droneLevels.join() !== TEAM_DRONE_LEVELS.join()) {
    throw new Error(`contract team drone levels ${economy.droneLevels} differ from the roster`);
  }

  let user = await ensureUser(ctx);
  if (user.bootstrapState === 'done') return report(ctx, user, true);
  if (user.bootstrapState === 'none') user = await createAccount(ctx, user);
  const owner = /** @type {string} */ (user.nearAccountId);
  const kit = { ...ctx, owner };

  if (user.bootstrapState === 'account') {
    await ensureBudget(ctx, owner, economy);
    await mintKit(kit, economy.startVolts);
    user = await advance(ctx, 'account', { bootstrapState: 'minted' });
  }
  await bindKit(kit, /** @type {string} */ (user.playKeyEnc));
  await cacheKit(kit);
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
  user = await fundAndRotate(ctx, user);
  const points = Number((await near.view('ft_balance_of', { account_id: owner })) ?? 0);
  user = await advance(ctx, 'minted', { bootstrapState: 'done', points });
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
 * @param {'none' | 'account' | 'minted'} from
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
 * `none -> account`: create `<slug>.<game>` with `create_player`. A create whose outcome was
 * unknown left its sealed keys in `bootstrap_pending`; it is resolved first, so keys of an account
 * that did get created are never lost.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @returns {Promise<UserRow>}
 */
async function createAccount(ctx, user) {
  const { near, def } = ctx;
  const pending = /** @type {PendingCreate[]} */ (user.bootstrapPending ?? []);
  for (const attempt of pending) {
    if (await landed(ctx, attempt)) {
      ctx.record(`create_player ${attempt.accountId} (resolved)`, attempt.txHash);
      return storeKeys(ctx, attempt);
    }
  }
  try {
    const created = await near.createPlayerAccount({ slug: def.slug, isTeam: true });
    ctx.record(`create_player ${created.accountId}`, created.txHash);
    return await storeKeys(ctx, created);
  } catch (err) {
    const sealed = /** @type {{ pending?: Omit<PendingCreate, 'txHash'> }} */ (err).pending;
    if (err instanceof RpcUnknownOutcomeError && sealed) {
      const attempt = { ...sealed, txHash: err.txHash };
      await advance(ctx, 'none', { bootstrapPending: [...pending, attempt] });
      throw new SeedBlockedError(
        `create_player for ${def.slug} has an unknown outcome (tx ${err.txHash}); its keys are stored. Run the script again.`
      );
    }
    if (err instanceof ContractPanicError && err.panic === 'exists') {
      throw new SeedBlockedError(
        pending.length > 0
          ? `${def.slug} exists on chain and an earlier create is still unresolved. Run the script again.`
          : `${def.slug} exists on chain but this database holds no keys for it.`
      );
    }
    throw err;
  }
}

/**
 * True when a stored create attempt executed and created the account.
 * @param {Ctx} ctx
 * @param {PendingCreate} attempt
 */
async function landed(ctx, attempt) {
  try {
    const outcome = await ctx.near.resolveOutcome(attempt.accountId, 0, attempt.txHash, {
      senderId: ctx.near.ownerId,
    });
    return outcome.applied && outcome.result === true;
  } catch (err) {
    if (err instanceof ContractPanicError || err instanceof TransactionFailedError) return false;
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
 * allowance. A rotated key (`key_version` above 1) means both are done.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @returns {Promise<UserRow>}
 */
async function fundAndRotate(ctx, user) {
  const { near, def } = ctx;
  const owner = /** @type {string} */ (user.nearAccountId);
  if ((user.keyVersion ?? 1) > 1) return user;
  if ((await near.accountBalance(owner)) < TEAM_GAS_YOCTO) {
    if ((await near.accountBalance(near.ownerId)) < MIN_OWNER_YOCTO) {
      throw new SeedBlockedError(
        `${near.ownerId} holds under 10 NEAR; fund it before sending ${def.slug} its gas. Run the script again after.`
      );
    }
    if (!ctx.fund) throw new SeedBlockedError(`${owner} needs its 2 NEAR gas float.`);
    await ctx.fund({ accountId: owner, from: near.ownerId, yocto: TEAM_GAS_YOCTO });
    if ((await near.accountBalance(owner)) < TEAM_GAS_YOCTO) {
      throw new SeedBlockedError(`${owner} still holds under 2 NEAR. Run the script again.`);
    }
  }
  let rotated;
  try {
    rotated = await near.rotatePlayKey(owner, /** @type {string} */ (user.adminKeyEnc), {
      keyVersion: user.keyVersion ?? 1,
      allowance: TEAM_GAS_YOCTO,
    });
  } catch (err) {
    if (!(err instanceof RpcUnknownOutcomeError)) throw err;
    // Rotating again is safe: it deletes whichever play key is on the account and adds a new one.
    throw new SeedBlockedError(
      `the play key rotation of ${def.slug} has an unknown outcome (tx ${err.txHash}). Run the script again.`
    );
  }
  ctx.record(
    `rotatePlayKey to a 2 NEAR allowance (key version ${rotated.keyVersion})`,
    rotated.txHash
  );
  return advance(ctx, 'minted', {
    playKeyEnc: rotated.playKeyEnc,
    keyVersion: rotated.keyVersion,
  });
}
