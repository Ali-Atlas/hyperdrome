/**
 * The showcase seed (SPEC.md 6, Showcase seed), run by `scripts/seed-showcase.mjs`: a kit minted
 * to the operator's account and four pilot accounts that list items on the marketplace. It adds no
 * chain path of its own. Pilot accounts come from the player bootstrap (12); every mint goes
 * through the ops action path and every bind and listing through the player action path (8),
 * under an action id derived from the account and the step. A second run replays each stored
 * answer and sends nothing; a run that stopped resumes at the first step without an answer.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { getNear } from '@/lib/near';
import { activeSlotsFor } from '@/lib/game-engine/economy.js';
import {
  OPERATOR_KIT,
  PILOTS,
  droneKey,
  kitSteps,
  pilotEmail,
  pilotKit,
  plannedSkinMints,
  showcaseActionId,
} from '@/lib/showcase/plan.js';
import { findAction } from './action-store.js';
import { BootstrapPendingError, runBootstrap } from './bootstrap.service.js';
import { applyEvents } from './chain-cache.service.js';
import { bindItem, listToken, setDroneActive } from './gameplay.service.js';
import { runOpsAction } from './ops-action.service.js';
import { SeedBlockedError } from './team-seed-kit.js';
import { syncWallet } from './wallet-sync.js';

export { SeedBlockedError };

const { users, drones } = schema;

/** Ids tried for one step: a stored `failed` answer is final, so the next attempt takes a new id. */
const STEP_ATTEMPTS = 3;
/** Calls of one step while the account's lease is held or the chain does not answer. */
const BUSY_TRIES = 6;
const BUSY_WAIT_MS = 5_000;
/** The action paths' answer while another request holds the account's lease (8). */
const LEASE_HELD = 'Another action is still in progress.';
/** Bootstrap calls per pilot: three transitions, and room for a held lease. */
const BOOTSTRAP_CALLS = 12;

/**
 * @typedef {import('@/lib/showcase/plan.js').Step} Step
 * @typedef {import('@/lib/showcase/plan.js').Kit} Kit
 * @typedef {import('./action-store.js').ActionResponse} ActionResponse
 * @typedef {typeof users.$inferSelect} UserRow
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter, log?: (line: string) => void, wait?: (ms: number) => Promise<void> }} Deps
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, log: (line: string) => void, wait: (ms: number) => Promise<void> }} Ctx
 * @typedef {{ key: string, label: string, token: string | null, txHash: string | null, replayed: boolean }} StepReport
 * @typedef {{ username: string, accountId: string, steps: StepReport[], activated: string[] }} AccountReport
 *   `activated`: the drones this run set active
 */

/** @param {Deps} deps @returns {Ctx} */
export const context = (deps) => ({
  db: deps.db ?? defaultDb,
  near: deps.near ?? getNear(),
  log: deps.log ?? (() => {}),
  wait: deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
});

/**
 * Run the whole seed: the supply check, the operator's kit, then each pilot.
 * @param {{ operatorAccount: string }} input the operator's NEAR account id
 * @param {Deps} [deps]
 * @returns {Promise<AccountReport[]>}
 */
export async function seedShowcase({ operatorAccount }, deps = {}) {
  const ctx = context(deps);
  const operator = await operatorUser(ctx, operatorAccount);
  await checkSupply(ctx);
  const reports = [await seedKit(ctx, operator, OPERATOR_KIT)];
  for (const pilot of PILOTS) {
    const user = await ensurePilot(ctx, pilot);
    reports.push(await seedKit(ctx, user, pilotKit(pilot)));
  }
  return reports;
}

/**
 * The operator's users row: a finished player account, never a team or one of the seed's pilots.
 * @param {Ctx} ctx
 * @param {string} accountId
 * @returns {Promise<UserRow>}
 */
export async function operatorUser(ctx, accountId) {
  const [row] = await ctx.db.select().from(users).where(eq(users.nearAccountId, accountId));
  if (!row) throw new Error(`no user holds ${accountId} in this database`);
  if (row.isTeam || PILOTS.some((pilot) => pilotEmail(pilot) === row.email)) {
    throw new Error(`${accountId} is a team or a seeded pilot, not a player's account`);
  }
  if (row.bootstrapState !== 'done') throw new Error(`${accountId} has not finished its setup`);
  return row;
}

/**
 * Every skin template the plan mints must fit under its on-chain cap (2.6), counted as if nothing
 * of the plan were minted yet, so a run never starts what the caps would stop half way.
 * @param {Ctx} ctx
 * @returns {Promise<{ template: number, cap: number | null, minted: number, planned: number }[]>}
 */
export async function checkSupply(ctx) {
  const catalog =
    /** @type {{ skins: { id: number, cap: number | null, minted: number }[] } | null} */ (
      await ctx.near.view('get_catalog', {})
    );
  if (!catalog) throw new Error('get_catalog returned nothing');
  const rows = [];
  for (const [template, planned] of plannedSkinMints()) {
    const skin = catalog.skins.find((s) => s.id === template);
    if (!skin || !Number.isInteger(skin.minted)) {
      throw new Error(`skin template ${template} is not in the catalog with a minted count`);
    }
    if (skin.cap !== null && skin.minted + planned > skin.cap) {
      throw new Error(
        `skin template ${template}: ${skin.minted} minted and ${planned} planned exceed the cap of ${skin.cap}`
      );
    }
    rows.push({ template, cap: skin.cap, minted: skin.minted, planned });
  }
  return rows;
}

/**
 * A pilot's users row with a finished bootstrap: the same account, starter kit and binds every
 * player gets (12).
 * @param {Ctx} ctx
 * @param {import('@/lib/showcase/plan.js').PilotDef} pilot
 * @returns {Promise<UserRow>}
 */
async function ensurePilot(ctx, pilot) {
  const email = pilotEmail(pilot);
  await ctx.db
    .insert(users)
    .values({ email, username: pilot.username, name: pilot.username, emailVerified: new Date() })
    .onConflictDoNothing({ target: users.email });
  const read = async () => {
    const [row] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
    return /** @type {UserRow} */ (row);
  };
  let user = await read();
  for (let i = 0; i < BOOTSTRAP_CALLS && user.bootstrapState !== 'done'; i += 1) {
    try {
      const status = await runBootstrap(user.id, ctx);
      if (status.busy) await ctx.wait(BUSY_WAIT_MS);
    } catch (err) {
      if (!(err instanceof BootstrapPendingError)) throw err;
      throw new SeedBlockedError(
        `${pilot.username}: the account creation has no outcome yet. Run the script again in a minute.`
      );
    }
    user = await read();
    if (user.bootstrapState !== 'none') {
      ctx.log(`${pilot.username}: bootstrap ${user.bootstrapState} ${user.nearAccountId}`);
    }
  }
  if (user.bootstrapState !== 'done') {
    throw new SeedBlockedError(`${pilot.username} is not set up yet. Run the script again.`);
  }
  return user;
}

/**
 * Send a kit's steps for one account: mints, a cache sync from the chain, binds, listings, and
 * last the active flags.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @param {Kit} kit
 * @returns {Promise<AccountReport>}
 */
async function seedKit(ctx, user, kit) {
  const accountId = /** @type {string} */ (user.nearAccountId);
  const username = /** @type {string} */ (user.username);
  /** @type {Map<string, string>} piece key -> token id */
  const tokens = new Map();
  /** @type {StepReport[]} */
  const reports = [];
  const tokenOf = (/** @type {string | undefined} */ key) => {
    const token = key ? tokens.get(key) : undefined;
    if (!token) throw new Error(`${username}: no token for ${key}`);
    return token;
  };
  const steps = kitSteps(kit);
  let synced = false;
  for (const step of steps) {
    const mint = step.method.startsWith('mint_');
    if (!mint && !synced) {
      // Binds and listings check ownership against the cache; a mint whose cache write failed
      // is repaired here from the chain's views.
      const res = await syncWallet({ userId: user.id }, ctx);
      if (res.status !== 200) throw new Error(`${username}: cache sync: ${res.body.error}`);
      synced = true;
    }
    const { body, replayed } = await sendStep(ctx, accountId, step, async (actionId) => {
      if (mint) return mintStep(ctx, user, step, actionId);
      if (step.method === 'bind') {
        const drone = tokenOf(step.drone);
        const [row] = await ctx.db
          .select({ id: drones.id })
          .from(drones)
          .where(eq(drones.tokenId, drone));
        if (!row) throw new Error(`${username}: ${drone} is not in the cache`);
        const item = tokenOf(step.piece);
        return bindItem({ userId: user.id, droneId: row.id, actionId, item }, ctx);
      }
      const token = tokenOf(step.piece);
      return listToken({ userId: user.id, actionId, token, price: Number(step.price) }, ctx);
    });
    const minted = body.token ?? body.result;
    const token = mint && step.method !== 'mint_volts' ? String(minted ?? '') : null;
    if (token === '') throw new Error(`${username}: ${step.label} returned no token id`);
    if (token) tokens.set(step.key, token);
    const txHash = typeof body.txHash === 'string' ? body.txHash : null;
    reports.push({ key: step.key, label: step.label, token, txHash, replayed });
    const link = txHash ? ctx.near.explorerTx(txHash) : '';
    ctx.log(
      `${username}: ${replayed ? 'done earlier' : 'sent'}: ${step.label}${token ? ` -> ${token}` : ''} ${link}`
    );
  }
  const activated = await activateKit(ctx, user, kit, tokens);
  if (activated.length > 0) ctx.log(`${username}: set active: ${activated.join(', ')}`);
  return { username, accountId, steps: reports, activated };
}

/**
 * Set the kit's racing drones active (database only, 8), as far as the account's active slots go
 * (2.2), through the toggle the app uses. It acts only while none of them is active, so a second
 * run never undoes a choice the player made since. Other active drones (the starter) are set
 * inactive, oldest first, only to free the slots the kit's drones take.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @param {Kit} kit
 * @param {Map<string, string>} tokens piece key -> token id
 * @returns {Promise<string[]>} the names set active now
 */
async function activateKit(ctx, user, kit, tokens) {
  /** @type {(typeof drones.$inferSelect)[]} */
  const fleet = await ctx.db
    .select()
    .from(drones)
    .where(eq(drones.userId, user.id))
    .orderBy(drones.createdAt);
  const wanted = kit.active.map((name) => {
    const row = fleet.find((d) => d.tokenId === tokens.get(droneKey({ name })));
    if (!row) throw new Error(`${user.username}: ${name} is not in the cache`);
    return row;
  });
  if (wanted.some((d) => d.active)) return [];
  const [fresh] = await ctx.db
    .select({ totalRaces: users.totalRaces })
    .from(users)
    .where(eq(users.id, user.id));
  const targets = wanted.slice(0, activeSlotsFor(fresh?.totalRaces ?? 0));
  const others = fleet.filter((d) => d.active);
  let free = activeSlotsFor(fresh?.totalRaces ?? 0) - others.length;
  /** @param {typeof drones.$inferSelect} drone @param {boolean} active */
  const toggle = async (drone, active) => {
    const res = await setDroneActive({ userId: user.id, droneId: drone.id, active }, ctx);
    if (res.status !== 200) throw new Error(`${user.username}: ${drone.name}: ${res.body.error}`);
  };
  for (const drone of others) {
    if (free >= targets.length) break;
    await toggle(drone, false);
    free += 1;
  }
  for (const drone of targets) await toggle(drone, true);
  return targets.map((d) => d.name);
}

/**
 * One mint with the ops key through the ops action path. The token id comes from the mint's
 * event, so an outcome resolved later from its hash still yields it.
 * @param {Ctx} ctx
 * @param {UserRow} user
 * @param {Step} step
 * @param {string} actionId
 */
function mintStep(ctx, user, step, actionId) {
  const owner = /** @type {string} */ (user.nearAccountId);
  const args = step.method === 'mint_volts' ? { to: owner, ...step.args } : { owner, ...step.args };
  return runOpsAction(
    {
      userId: user.id,
      actionId,
      method: step.method,
      args,
      onApplied: async (events) => {
        const minted = events.find(
          (e) => e.standard === 'hyperdrome' && e.event.endsWith('_minted')
        );
        const token = /** @type {{ token?: string } | undefined} */ (minted?.data)?.token;
        try {
          await applyEvents(events, ctx);
        } catch (err) {
          // The mint stands; `seedKit` syncs the cache from the chain before the binds.
          console.error({ scope: 'showcase', msg: 'cache update failed', actionId, err: `${err}` });
        }
        return token ? { token } : {};
      },
    },
    ctx
  );
}

/**
 * The action ids a step may carry for an account, first attempt first.
 * @param {string} accountId
 * @param {Step} step
 */
export function attemptIds(accountId, step) {
  return Array.from({ length: STEP_ATTEMPTS }, (_, n) =>
    showcaseActionId(accountId, n === 0 ? step.key : `${step.key}#${n}`)
  );
}

/**
 * Run one step to a stored answer. An applied answer is returned (a replay sends nothing). A
 * `failed` answer is final for its id: the action paths store it only when the transaction did
 * not apply, so the step is sent again under the next id. An unknown outcome stops the run.
 * @param {Ctx} ctx
 * @param {string} accountId
 * @param {Step} step
 * @param {(actionId: string) => Promise<ActionResponse>} run
 * @returns {Promise<{ body: Record<string, unknown>, replayed: boolean }>}
 */
async function sendStep(ctx, accountId, step, run) {
  let last = '';
  for (const actionId of attemptIds(accountId, step)) {
    const earlier = await findAction(ctx.db, actionId);
    if (earlier?.status === 'failed') {
      last = earlier.error ?? 'failed';
      continue;
    }
    const res = await answered(ctx, accountId, step, () => run(actionId));
    if (res.status === 200) return { body: res.body, replayed: earlier?.status === 'applied' };
    last = String(res.body.error);
    // Only a stored `failed` answer frees the step for another id.
    if ((await findAction(ctx.db, actionId))?.status !== 'failed') break;
  }
  throw new Error(`${step.label} for ${accountId} did not go through: ${last}`);
}

/**
 * Call `run` until it gives an answer that is not "busy": the account's action lease held by
 * another request, or a chain that did not respond (nothing was stored as failed in either case).
 * @param {Ctx} ctx
 * @param {string} accountId
 * @param {Step} step
 * @param {() => Promise<ActionResponse>} run
 * @returns {Promise<ActionResponse>}
 */
async function answered(ctx, accountId, step, run) {
  for (let i = 0; i < BUSY_TRIES; i += 1) {
    const res = await run();
    if (res.status === 202) {
      throw new SeedBlockedError(
        `${step.label} for ${accountId} has no outcome yet (tx ${res.body.txHash}). Run the script again in a minute.`
      );
    }
    const busy = res.status === 503 || res.body.error === LEASE_HELD;
    if (!busy) return res;
    await ctx.wait(BUSY_WAIT_MS);
  }
  throw new SeedBlockedError(
    `${step.label} for ${accountId} could not be sent: the account is busy or the chain is not answering. Run the script again.`
  );
}
