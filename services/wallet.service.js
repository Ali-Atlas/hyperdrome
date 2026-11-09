/**
 * "Your wallet" (SPEC.md 8): the link challenge, the link itself and withdrawals through the app.
 * The chain holds the link (`get_wallet_link`); the database holds only the single-use challenges
 * and the cached assets the page lists. Sync lives in services/wallet-sync.js.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/lib/db';
import { mapChainError } from '@/lib/http/chain-errors.js';
import { getNear } from '@/lib/near';
import { ContractPanicError, RpcUnknownOutcomeError } from '@/lib/near/errors.js';
import { reject } from './action-store.js';
import { applyEvents } from './chain-cache.service.js';
import { runOpsAction } from './ops-action.service.js';
import { hitRateLimit } from './rate-limit.service.js';

const { users, drones, skins, mods, droneSkins, droneMods, walletChallenges, marketplaceListings } =
  schema;

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Challenges per user per hour: each one is a link the contract pays Volts storage for. */
const CHALLENGE_LIMIT = 10;
const CHALLENGE_WINDOW_MS = 60 * 60 * 1000;
/** Gas attached to `withdraw`: the SPEC.md 13 budget for the most tokens one call moves. */
export const WITHDRAW_GAS = 150_000_000_000_000n;

/**
 * @typedef {import('./action-store.js').ActionResponse} ActionResponse
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter }} Deps
 * @typedef {{ id: string, token: string | null, name: string, level: number, inBatch: number | null }} FleetRow
 */

/** @param {Deps} deps */
const resolveDeps = (deps) => ({ db: deps.db ?? defaultDb, near: deps.near ?? getNear() });

/**
 * Run a service call and answer 503 when the chain cannot be read.
 * @param {() => Promise<ActionResponse>} run
 * @returns {Promise<ActionResponse>}
 */
export async function answerOrUnavailable(run) {
  try {
    return await run();
  } catch (err) {
    console.error({ scope: 'wallet', msg: 'request failed', err: String(err) });
    return reject(503, 'The chain is not responding. Try again shortly.');
  }
}

/**
 * The user's NEAR account, once their bootstrap has finished.
 * @param {any} db
 * @param {string} userId
 * @returns {Promise<string | null>}
 */
async function playerAccount(db, userId) {
  const [user] = await db
    .select({ state: users.bootstrapState, account: users.nearAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user && user.state === 'done' && user.account ? user.account : null;
}

/**
 * A new single-use challenge: a 32-byte nonce bound to the user, the message naming the player's
 * NEAR account, and the app's host as the NEP-413 recipient.
 * @param {{ userId: string, host: string }} input
 * @param {Deps} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function createChallenge({ userId, host }, deps = {}) {
  const { db } = resolveDeps(deps);
  const account = await playerAccount(db, userId);
  if (!account) return reject(409, 'Your racing account is still being set up.');
  const allowed = await hitRateLimit(`wallet-challenge:${userId}`, {
    limit: CHALLENGE_LIMIT,
    windowMs: CHALLENGE_WINDOW_MS,
    db,
  });
  if (!allowed) return reject(429, 'Too many link attempts. Try again in an hour.');

  await db
    .delete(walletChallenges)
    .where(
      and(
        eq(walletChallenges.userId, userId),
        isNull(walletChallenges.usedAt),
        lt(walletChallenges.expiresAt, new Date())
      )
    );
  const nonce = randomBytes(32).toString('hex');
  const message = `Link this wallet to the Hyperdrome racing account ${account} on NEAR testnet.`;
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.insert(walletChallenges).values({ nonce, userId, message, recipient: host, expiresAt });
  return { status: 200, body: { nonce, message, recipient: host, expiresAt } };
}

/**
 * @typedef {{ accountId: string, publicKey: string, signature: string, nonce: string }} LinkBody
 */

/**
 * Verify a signed challenge and link the wallet with the ops key. Idempotent: after an unknown
 * outcome the same request reads `get_wallet_link` before sending, and a link to the same wallet
 * answers 200.
 * @param {{ userId: string, body: LinkBody }} input
 * @param {Deps} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function linkWallet({ userId, body }, deps = {}) {
  const { db, near } = resolveDeps(deps);
  const { accountId: wallet, publicKey, signature, nonce } = body;
  const account = await playerAccount(db, userId);
  if (!account) return reject(409, 'Your racing account is still being set up.');

  const [row] = await db
    .select()
    .from(walletChallenges)
    .where(and(eq(walletChallenges.nonce, nonce), eq(walletChallenges.userId, userId)))
    .limit(1);
  if (!row) return reject(404, 'This link request is not valid. Start again.');

  let valid;
  try {
    valid = await near.verifyWalletSignature({
      accountId: wallet,
      publicKey,
      signature,
      message: row.message,
      nonce: Buffer.from(nonce, 'hex'),
      recipient: row.recipient,
    });
  } catch (err) {
    console.error({ scope: 'wallet', msg: 'signature check failed', err: String(err) });
    return reject(503, 'The chain is not responding. Try again shortly.');
  }
  if (!valid) return reject(403, 'The wallet signature is not valid. Try again.');

  // Past its expiry a challenge can only confirm the link it already made.
  if (row.expiresAt < new Date()) {
    if (row.wallet === wallet && (await readLink(near, account)) === wallet) {
      return linkedAnswer(near, account, wallet, null);
    }
    return reject(410, 'This link request expired. Start again.');
  }

  // Single use: a request whose nonce was claimed by this same wallet may only finish that link.
  const [claimed] = await db
    .update(walletChallenges)
    .set({ usedAt: new Date(), wallet })
    .where(
      and(
        eq(walletChallenges.nonce, nonce),
        eq(walletChallenges.userId, userId),
        or(
          isNull(walletChallenges.usedAt),
          and(eq(walletChallenges.wallet, wallet), isNull(walletChallenges.linkedAt))
        )
      )
    )
    .returning({ nonce: walletChallenges.nonce });
  if (!claimed) {
    const current = await readLink(near, account);
    if (row.linkedAt && current === wallet) return linkedAnswer(near, account, wallet, null);
    return reject(409, 'This link request was already used. Start again.');
  }

  return finishLink({ db, near, account, wallet, nonce });
}

/**
 * The chain-reading half of the link: reads the link, sends `link_wallet` only when none exists.
 * @param {{ db: any, near: import('@/lib/near').NearAdapter, account: string, wallet: string, nonce: string }} ctx
 * @returns {Promise<ActionResponse>}
 */
async function finishLink({ db, near, account, wallet, nonce }) {
  const markLinked = () =>
    db
      .update(walletChallenges)
      .set({ linkedAt: new Date() })
      .where(eq(walletChallenges.nonce, nonce));

  try {
    const current = await readLink(near, account);
    if (current === wallet) {
      await markLinked();
      return linkedAnswer(near, account, wallet, null);
    }
    if (current) {
      const mapped = mapChainError('linked');
      return reject(mapped.status, mapped.error);
    }
    const sent = await near.callAsOps('link_wallet', { player: account, wallet });
    await markLinked();
    return linkedAnswer(near, account, wallet, sent.txHash);
  } catch (err) {
    if (err instanceof ContractPanicError) {
      if (err.panic === 'linked' && (await readLink(near, account)) === wallet) {
        await markLinked();
        return linkedAnswer(near, account, wallet, null);
      }
      const mapped = mapChainError(err.panic);
      return reject(mapped.status, mapped.error);
    }
    if (err instanceof RpcUnknownOutcomeError) {
      return { status: 202, body: { pending: true, txHash: err.txHash } };
    }
    console.error({ scope: 'wallet', msg: 'link failed', account, err: String(err) });
    return reject(503, 'The chain is not responding. Try again shortly.');
  }
}

/**
 * @param {import('@/lib/near').NearAdapter} near
 * @param {string} account
 * @returns {Promise<string | null>}
 */
async function readLink(near, account) {
  return /** @type {string | null} */ (await near.view('get_wallet_link', { player: account }));
}

/**
 * @param {import('@/lib/near').NearAdapter} near
 * @param {string} account
 * @param {string} wallet
 * @param {string | null} txHash
 * @returns {ActionResponse}
 */
function linkedAnswer(near, account, wallet, txHash) {
  return {
    status: 200,
    body: {
      linked: true,
      account,
      wallet,
      walletExplorerUrl: near.explorerAccount(wallet),
      txHash,
      explorerUrl: txHash ? near.explorerTx(txHash) : null,
    },
  };
}

/**
 * Withdraw through the app: `withdraw` with the ops key, with the action path's guarantees
 * (services/ops-action.service.js). The destination is always the linked wallet.
 * @param {{ userId: string, actionId: string, tokens: string[], volts: number }} input
 * @param {Deps} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function withdrawToWallet({ userId, actionId, tokens, volts }, deps = {}) {
  const { db, near } = resolveDeps(deps);
  const account = await playerAccount(db, userId);
  if (!account) return reject(409, 'Your racing account is still being set up.');
  return runOpsAction(
    {
      userId,
      actionId,
      method: 'withdraw',
      args: { player: account, tokens, volts: String(volts) },
      gas: WITHDRAW_GAS,
      onApplied: async (events) => {
        const { balances } = await applyEvents(events, { db, near });
        return account in balances ? { volts: balances[account] } : {};
      },
    },
    { db, near }
  );
}

/**
 * The contract's per-call token limit, for the page's counter (null until the upgrade lands).
 * @param {import('@/lib/near').NearAdapter} near
 * @returns {Promise<number | null>}
 */
async function maxWithdrawTokens(near) {
  const constants = /** @type {{ economy?: { max_withdraw_tokens?: number } }} */ (
    await near.getConstants()
  );
  return constants.economy?.max_withdraw_tokens ?? null;
}

/**
 * What the wallet page shows: the link, the player's Volts, drones with their bound items and
 * unbound skins and mods, from the cache (a drone in a batch or listed cannot be withdrawn).
 * @param {{ userId: string }} input
 * @param {Deps} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function walletState({ userId }, deps = {}) {
  const { db, near } = resolveDeps(deps);
  const account = await playerAccount(db, userId);
  if (!account) return reject(409, 'Your racing account is still being set up.');

  const link = await readLink(near, account);
  const [user] = await db
    .select({ volts: users.points })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const fleet = await db
    .select({
      id: drones.id,
      token: drones.tokenId,
      name: drones.name,
      level: drones.level,
      inBatch: drones.inBatch,
    })
    .from(drones)
    .where(and(eq(drones.userId, userId), isNotNull(drones.tokenId)))
    .orderBy(sql`${drones.level} desc`);

  const listed = await db
    .select({ token: marketplaceListings.tokenId })
    .from(marketplaceListings)
    .where(and(eq(marketplaceListings.sellerId, userId), eq(marketplaceListings.status, 'active')));
  const listedTokens = new Set(listed.map((/** @type {{ token: string }} */ l) => l.token));

  const boundSkins = await db
    .select({ droneId: droneSkins.droneId, token: skins.tokenId, name: skins.name })
    .from(droneSkins)
    .innerJoin(skins, eq(skins.id, droneSkins.skinId))
    .innerJoin(drones, eq(drones.id, droneSkins.droneId))
    .where(eq(drones.userId, userId));
  const boundMods = await db
    .select({ droneId: droneMods.droneId, token: mods.tokenId, name: mods.name })
    .from(droneMods)
    .innerJoin(mods, eq(mods.id, droneMods.modId))
    .innerJoin(drones, eq(drones.id, droneMods.droneId))
    .where(eq(drones.userId, userId));
  const boundTokens = new Set(
    [...boundSkins, ...boundMods].map((b) => /** @type {string} */ (b.token))
  );

  /** @param {{ droneId: string, token: string | null, name: string }[]} rows @param {string} droneId */
  const namesFor = (rows, droneId) => rows.filter((r) => r.droneId === droneId).map((r) => r.name);

  const ownedSkins = await db
    .select({ token: skins.tokenId, name: skins.name, rarity: skins.rarity })
    .from(skins)
    .where(and(eq(skins.userId, userId), isNotNull(skins.tokenId)));
  const ownedMods = await db
    .select({ token: mods.tokenId, name: mods.name, rarity: mods.rarity })
    .from(mods)
    .where(and(eq(mods.userId, userId), isNotNull(mods.tokenId)));
  /** @param {string} kind @returns {(i: { token: string | null, name: string, rarity: string }) => any} */
  const toItem = (kind) => (i) => ({ ...i, kind, listed: listedTokens.has(i.token ?? '') });
  /** @param {{ token: string | null }} i */
  const unbound = (i) => !boundTokens.has(/** @type {string} */ (i.token));

  return {
    status: 200,
    body: {
      account,
      wallet: link,
      walletExplorerUrl: link ? near.explorerAccount(link) : null,
      gameId: near.gameId,
      volts: user?.volts ?? 0,
      maxTokens: await maxWithdrawTokens(near),
      drones: fleet.map((/** @type {FleetRow} */ d) => ({
        token: d.token,
        name: d.name,
        level: d.level,
        racing: d.inBatch !== null,
        listed: listedTokens.has(d.token ?? ''),
        boundSkins: namesFor(boundSkins, d.id),
        boundMods: namesFor(boundMods, d.id),
      })),
      items: [
        ...ownedSkins.filter(unbound).map(toItem('skin')),
        ...ownedMods.filter(unbound).map(toItem('mod')),
      ],
    },
  };
}
