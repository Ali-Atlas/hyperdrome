/**
 * Skin packs and mod capsules (SPEC.md 2.7, 4.4): commit-reveal in one request. The server makes
 * a 32-byte secret, seals it into a `pack_opens` row (AAD = the action id) before anything is
 * sent, commits sha256(secret) with `open_pack`, then sends `reveal_pack` with the secret. The
 * reveal lands in a later block than the commit by construction (the commit has executed when it
 * returns); on `too early` it waits 1 s and retries once. Replaying the same action id resumes
 * from the stored row, so a crash between the two calls never loses the burned Volts.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db as defaultDb, schema } from '@/lib/db';
import { CHAIN_ERRORS } from '@/lib/http/chain-errors.js';
import { PACK_TIERS } from '@/lib/validators/gameplay.js';
import { getNear } from '@/lib/near';
import { runPlayerAction } from './action.service.js';
import { applyEvents } from './chain-cache.service.js';

const { users, packOpens, skins, mods } = schema;

/** Wait before the one retry of a reveal that came in too early. */
export const REVEAL_RETRY_MS = 1_000;

/**
 * @typedef {import('./action.service.js').ActionResponse} ActionResponse
 * @typedef {typeof packOpens.$inferSelect} PackOpenRow
 * @typedef {{ db?: any, near?: import('@/lib/near').NearAdapter, secretKey?: string, sleep?: (ms: number) => Promise<void> }} Deps
 * @typedef {{ db: any, near: import('@/lib/near').NearAdapter, secretKey: string, sleep: (ms: number) => Promise<void> }} FullDeps
 */

/** The key pack secrets are sealed under (`KEY_ENCRYPTION_KEY`, SPEC.md 6). */
function readSecretKey() {
  return z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .parse(process.env.KEY_ENCRYPTION_KEY);
}

/**
 * @param {number} status
 * @param {string} error
 * @returns {ActionResponse}
 */
const reject = (status, error) => ({ status, body: { error } });

/**
 * The action id of a pack's reveal: a uuid derived from the open's action id, so a replay of the
 * open finds the reveal it already sent.
 * @param {string} actionId
 */
export function revealActionId(actionId) {
  const b = createHash('sha256').update(`reveal:${actionId}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Open a skin pack or mod capsule, or resume one by its action id.
 * @param {{ userId: string, actionId: string, kind: 'skin' | 'mod', tier: (typeof PACK_TIERS)[number] }} input
 * @param {Deps} [deps]
 * @returns {Promise<ActionResponse>}
 */
export async function openPack({ userId, actionId, kind, tier }, deps = {}) {
  /** @type {FullDeps} */
  const d = {
    db: deps.db ?? defaultDb,
    near: deps.near ?? getNear(),
    secretKey: deps.secretKey ?? readSecretKey(),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
  const tierId = PACK_TIERS.indexOf(tier);
  const [user] = await d.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user?.bootstrapState !== 'done') {
    return reject(409, 'Your racing account is still being set up.');
  }

  await d.db
    .insert(packOpens)
    .values({
      actionId,
      userId,
      kind,
      tier: tierId,
      secretEnc: d.near.sealSecret(randomBytes(32), d.secretKey, actionId),
    })
    .onConflictDoNothing();
  const [row] = await d.db.select().from(packOpens).where(eq(packOpens.actionId, actionId));
  if (!row || row.userId !== userId || row.kind !== kind || row.tier !== tierId) {
    return reject(409, 'This action id was already used for a different action.');
  }
  const secret = d.near.openSecret(row.secretEnc, d.secretKey, actionId);

  let commit = { packId: row.packId, txHash: row.commitTx };
  if (row.status === 'pending') {
    const opened = await runPlayerAction(
      {
        userId,
        actionId,
        method: 'open_pack',
        args: { kind, tier: tierId, hash: [...createHash('sha256').update(secret).digest()] },
        onApplied: (events) => applyEvents(events, d).then(() => ({})),
      },
      d
    );
    if (opened.status !== 200) return opened;
    commit = {
      packId: Number(opened.body.result),
      txHash: /** @type {string} */ (opened.body.txHash),
    };
    await d.db
      .update(packOpens)
      .set({ status: 'committed', packId: commit.packId, commitTx: commit.txHash })
      .where(and(eq(packOpens.actionId, actionId), eq(packOpens.status, 'pending')));
  }

  const revealed = await reveal(d, userId, actionId, Number(commit.packId), secret);
  if (revealed.status === 202) return { status: 202, body: { pending: true, actionId } };
  if (revealed.status !== 200) return revealed;
  return {
    status: 200,
    body: {
      ...revealed.body,
      actionId,
      packId: commit.packId,
      commitTxHash: commit.txHash,
      commitExplorerUrl: commit.txHash ? d.near.explorerTx(commit.txHash) : null,
    },
  };
}

/**
 * Send (or resume) the reveal; on `too early`, wait and retry once.
 * @param {FullDeps} d
 * @param {string} userId
 * @param {string} actionId the open's action id
 * @param {number} packId
 * @param {Uint8Array} secret
 * @returns {Promise<ActionResponse>}
 */
async function reveal(d, userId, actionId, packId, secret) {
  const send = () =>
    runPlayerAction(
      {
        userId,
        actionId: revealActionId(actionId),
        method: 'reveal_pack',
        args: { pack_id: packId, secret: [...secret] },
        recordArgs: { pack_id: packId },
        transient: ['too early'],
        onApplied: async (events) => {
          await applyEvents(events, d);
          const opened = events.find((e) => e.event === 'pack_opened');
          const tokens = /** @type {string[]} */ (
            /** @type {{ tokens?: string[] } | undefined} */ (opened?.data)?.tokens ?? []
          );
          return { tokens, items: await packItems(d.db, tokens) };
        },
      },
      d
    );
  let res = await send();
  if (res.status === 409 && res.body.error === CHAIN_ERRORS['too early'].error) {
    await d.sleep(REVEAL_RETRY_MS);
    res = await send();
  }
  if (res.status === 200) {
    await d.db
      .update(packOpens)
      .set({
        status: 'revealed',
        revealTx: /** @type {string} */ (res.body.txHash),
        tokens: res.body.tokens ?? null,
      })
      .where(eq(packOpens.actionId, actionId));
  }
  return res;
}

/**
 * The cached skins and mods a pack minted, for the reveal screen.
 * @param {any} db
 * @param {string[]} tokens
 */
async function packItems(db, tokens) {
  if (tokens.length === 0) return [];
  const [skinRows, modRows] = await Promise.all([
    db.select().from(skins).where(inArray(skins.tokenId, tokens)),
    db.select().from(mods).where(inArray(mods.tokenId, tokens)),
  ]);
  /** @type {Map<string, Record<string, unknown>>} */
  const byToken = new Map();
  for (const s of skinRows) {
    byToken.set(s.tokenId, { kind: 'skin', ...pick(s, ['tokenId', 'name', 'rarity', 'imageUrl']) });
  }
  for (const m of modRows) {
    byToken.set(m.tokenId, { kind: 'mod', ...pick(m, ['tokenId', 'name', 'rarity', 'template']) });
  }
  return tokens.map((t) => byToken.get(t) ?? { tokenId: t });
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} keys
 */
const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));

/**
 * A player's pack open by action id (uuid) or on-chain pack id, without its secret.
 * @param {string} userId
 * @param {string} id
 * @param {{ db?: any }} [deps]
 */
export async function getPackOpen(userId, id, deps = {}) {
  const db = deps.db ?? defaultDb;
  const byAction = z.uuid().safeParse(id).success;
  if (!byAction && !/^[1-9][0-9]{0,15}$/.test(id)) return null;
  const [row] = await db
    .select()
    .from(packOpens)
    .where(
      and(
        eq(packOpens.userId, userId),
        byAction ? eq(packOpens.actionId, id) : eq(packOpens.packId, Number(id))
      )
    )
    .limit(1);
  if (!row) return null;
  const tokens = /** @type {string[]} */ (row.tokens ?? []);
  return {
    actionId: row.actionId,
    packId: row.packId,
    kind: row.kind,
    tier: PACK_TIERS[row.tier],
    status: row.status,
    commitTxHash: row.commitTx,
    revealTxHash: row.revealTx,
    tokens,
    items: await packItems(db, tokens),
    createdAt: row.createdAt,
  };
}
