/**
 * Pack and capsule opens (services/pack-open.service.js, SPEC.md 2.7, 4.4): commit then reveal,
 * resuming a committed pack on replay without a second `open_pack`, and the `too early` retry.
 */
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { ContractPanicError } from '../../lib/near/errors.js';
import { openPack, revealActionId } from '../../services/pack-open.service.js';
import { TEST_SECRET_KEY, createMockNear, dbEnabled, ev, newPlayer, testDb } from './setup.js';

const { packOpens, mods, actions } = schema;

describe.skipIf(!dbEnabled)('openPack', () => {
  const db = testDb();
  afterAll(async () => {
    await db?.$client?.end?.();
  });

  /**
   * A mock chain with `open_pack` and `reveal_pack` that check the commit like the contract
   * (sha256(secret) == hash) and mint three mods.
   * @param {{ revealFailures?: Array<() => never> }} [options] thrown by the first reveals, in order
   */
  function packChain(options = {}) {
    const near = createMockNear();
    const failures = [...(options.revealFailures ?? [])];
    /** @type {Map<number, { hash: string, buyer: string | null }>} */
    const packs = new Map();
    let nextPack = Math.floor(Math.random() * 1e9);
    let nextMod = Math.floor(Math.random() * 1e9);
    const counts = { open: 0, reveal: 0 };

    near.mock.on('open_pack', (/** @type {any} */ args, { accountId }) => {
      counts.open += 1;
      const id = ++nextPack;
      packs.set(id, { hash: Buffer.from(args.hash).toString('hex'), buyer: accountId });
      return {
        result: id,
        events: [
          ev('pack_committed', { pack_id: id, buyer: accountId, kind: args.kind, tier: args.tier }),
          ev('ft_burn', [{ owner_id: accountId, amount: '1000' }], 'nep141'),
        ],
      };
    });
    near.mock.on('reveal_pack', (/** @type {any} */ args, { accountId }) => {
      counts.reveal += 1;
      const fail = failures.shift();
      if (fail) fail();
      const pack = packs.get(args.pack_id);
      const hash = createHash('sha256').update(Buffer.from(args.secret)).digest('hex');
      if (!pack || pack.hash !== hash) throw new ContractPanicError('bad reveal');
      const tokens = [1, 2, 3].map(() => `m:${++nextMod}`);
      return {
        result: null,
        events: [
          ...tokens.map((token, i) =>
            ev('item_minted', { token, owner: accountId, kind: 'mod', template: 1 + i, rarity: 0 })
          ),
          ev('pack_opened', { pack_id: args.pack_id, tokens }),
        ],
      };
    });
    near.mock.on('ft_balance_of', () => ({ result: '500' }));
    return { near, counts };
  }

  /**
   * @param {string} userId
   * @param {string} actionId
   * @param {any} near
   */
  const open = (userId, actionId, near) =>
    openPack(
      { userId, actionId, kind: 'mod', tier: 'starter' },
      { db, near, secretKey: TEST_SECRET_KEY, sleep: async () => {} }
    );

  it('commits, reveals and caches the three minted items', async () => {
    const { near, counts } = packChain();
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();

    const res = await open(user.id, actionId, near);
    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(3);
    expect(res.body.items).toHaveLength(3);
    expect(counts).toEqual({ open: 1, reveal: 1 });

    const [row] = await db.select().from(packOpens).where(eq(packOpens.actionId, actionId));
    expect(row).toMatchObject({
      status: 'revealed',
      packId: res.body.packId,
      kind: 'mod',
      tier: 0,
    });
    expect(row.tokens).toEqual(res.body.tokens);
    const owned = await db.select().from(mods).where(eq(mods.userId, user.id));
    const tokens = /** @type {string[]} */ (res.body.tokens);
    expect(owned.map((/** @type {any} */ m) => m.tokenId).sort()).toEqual([...tokens].sort());

    // The reveal's stored args never hold the secret.
    const [reveal] = await db
      .select()
      .from(actions)
      .where(eq(actions.id, revealActionId(actionId)));
    expect(reveal.args).toEqual({ pack_id: res.body.packId });
  });

  it('resumes a committed pack on replay without a second open_pack', async () => {
    const { near, counts } = packChain({
      revealFailures: [
        () => {
          throw new Error('connection reset');
        },
      ],
    });
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();

    const first = await open(user.id, actionId, near);
    expect(first.status).toBe(503);
    const [committed] = await db.select().from(packOpens).where(eq(packOpens.actionId, actionId));
    expect(committed.status).toBe('committed');

    const replay = await open(user.id, actionId, near);
    expect(replay.status).toBe(200);
    expect(replay.body.packId).toBe(committed.packId);
    expect(counts).toEqual({ open: 1, reveal: 2 });

    const again = await open(user.id, actionId, near);
    expect(again.body.tokens).toEqual(replay.body.tokens);
    expect(counts).toEqual({ open: 1, reveal: 2 });
  });

  it('waits and retries once when the reveal is too early', async () => {
    const { near, counts } = packChain({
      revealFailures: [
        () => {
          throw new ContractPanicError('too early', { method: 'reveal_pack' });
        },
      ],
    });
    const { user } = await newPlayer(db, near);
    const res = await open(user.id, randomUUID(), near);
    expect(res.status).toBe(200);
    expect(counts).toEqual({ open: 1, reveal: 2 });
  });

  it('stores a failed open and never reveals', async () => {
    const near = createMockNear();
    near.mock.on('open_pack', () => {
      throw new ContractPanicError('insufficient volts', { method: 'open_pack' });
    });
    const { user } = await newPlayer(db, near);
    const res = await open(user.id, randomUUID(), near);
    expect(res).toEqual({ status: 402, body: { error: 'Not enough Volts.' } });
    expect(near.mock.calls.some((c) => c.method === 'reveal_pack')).toBe(false);
  });

  it('keeps the minted tokens when the cache update fails', async () => {
    const near = createMockNear();
    let nextPack = Math.floor(Math.random() * 1e9);
    near.mock.on('open_pack', () => ({ result: ++nextPack, events: [] }));
    near.mock.on('reveal_pack', (/** @type {any} */ args, { accountId }) => ({
      events: [
        // An unknown template makes the cache update throw.
        ev('item_minted', {
          token: `m:${nextPack}9`,
          owner: accountId,
          kind: 'mod',
          template: 99,
          rarity: 0,
        }),
        ev('pack_opened', { pack_id: args.pack_id, tokens: [`m:${nextPack}9`] }),
      ],
    }));
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();
    const res = await open(user.id, actionId, near);
    expect(res.status).toBe(200);
    expect(res.body.tokens).toEqual([`m:${nextPack}9`]);
    const [row] = await db.select().from(packOpens).where(eq(packOpens.actionId, actionId));
    expect(row.tokens).toEqual([`m:${nextPack}9`]);
  });

  it('removes the pack row when the commit fails for good', async () => {
    const near = createMockNear();
    near.mock.on('open_pack', () => {
      throw new ContractPanicError('insufficient volts', { method: 'open_pack' });
    });
    const { user } = await newPlayer(db, near);
    const actionId = randomUUID();
    expect((await open(user.id, actionId, near)).status).toBe(402);
    expect(await db.select().from(packOpens).where(eq(packOpens.actionId, actionId))).toEqual([]);
    expect((await open(user.id, actionId, near)).status).toBe(402);
  });
});
