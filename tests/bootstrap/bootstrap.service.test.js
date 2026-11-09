/**
 * Bootstrap state machine (SPEC.md 12) against the mock adapter and a real Postgres with the
 * committed migration (CI's service; locally any non-Neon DATABASE_URL, docs/runbooks/dev-setup.md).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, isNeonUrl, schema } from '../../lib/db/index.js';
import { utcDayKey } from '../../lib/live/summary.js';
import { ContractPanicError } from '../../lib/near/errors.js';
import { BootstrapPendingError, runBootstrap } from '../../services/bootstrap.service.js';
import { createFakeGame } from './fake-game.js';

const url = process.env.DATABASE_URL ?? '';
// CI always has the test database; elsewhere the suite needs one and never touches Neon.
const enabled = Boolean(process.env.CI) || (url !== '' && !isNeonUrl(url));
const { users, drones, skins, mods, droneSkins, droneMods, voltDaily } = schema;
const MOD_TEMPLATE = 3;

describe.skipIf(!enabled)('bootstrap service', () => {
  const db = /** @type {any} */ (enabled ? createDb(url) : null);
  afterAll(async () => {
    await db?.$client?.end?.();
  });

  /** A user with a unique username, so each test gets its own player slug. */
  async function newUser() {
    const username = `TESTER${randomBytes(3).toString('hex').toUpperCase()}`;
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@test.local`, username })
      .returning();
    return { ...user, slug: username.toLowerCase() };
  }

  /** @param {string} userId @param {ReturnType<typeof createFakeGame>} game */
  const run = (userId, game) =>
    runBootstrap(userId, { db, near: game.near, pickModTemplate: () => MOD_TEMPLATE });

  /** Call until done, as the dashboard does (one transition per call; three for a fresh user). */
  /** @param {string} userId @param {ReturnType<typeof createFakeGame>} game */
  async function untilDone(userId, game) {
    let status = await run(userId, game);
    for (let i = 1; i < 3 && status.state !== 'done'; i += 1) status = await run(userId, game);
    return status;
  }

  /** @param {string} userId */
  async function rows(userId) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const drone = (await db.select().from(drones).where(eq(drones.userId, userId)))[0];
    const skin = (await db.select().from(skins).where(eq(skins.userId, userId)))[0];
    const mod = (await db.select().from(mods).where(eq(mods.userId, userId)))[0];
    return { user, drone, skin, mod };
  }

  it('takes a fresh user to done in exactly three calls, one transition each, with cache rows and 1,000 Volts', async () => {
    const game = createFakeGame();
    const { id } = await newUser();
    const chainCalls = () => ({
      create: game.count('create_player'),
      mints: game.count('mint_drone') + game.count('mint_item') + game.count('mint_volts'),
      binds: game.count('bind'),
    });

    // Call 1: the account only.
    expect(await run(id, game)).toMatchObject({ state: 'account', droneId: null });
    expect(chainCalls()).toEqual({ create: 1, mints: 0, binds: 0 });
    expect((await rows(id)).user.bootstrapClaimedAt).toBeNull();

    // Call 2: the four mints only. The starter grant reaches the day's Volts record; other test
    // files may add to the same row, so this is a lower bound.
    const mintedToday = async () =>
      (
        await db
          .select()
          .from(voltDaily)
          .where(eq(voltDaily.day, utcDayKey(Date.now())))
      )[0]?.minted ?? 0;
    const before = await mintedToday();
    expect((await run(id, game)).state).toBe('minted');
    expect(chainCalls()).toEqual({ create: 1, mints: 4, binds: 0 });
    expect((await mintedToday()) - before).toBeGreaterThanOrEqual(1000);

    // Call 3: the two binds, then done.
    const status = await run(id, game);
    expect(chainCalls()).toEqual({ create: 1, mints: 4, binds: 2 });

    const { user, drone, skin, mod } = await rows(id);
    expect(status).toEqual({
      state: 'done',
      accountId: user.nearAccountId,
      explorerUrl: `https://testnet.nearblocks.io/address/${user.nearAccountId}`,
      droneId: drone.id,
    });
    expect(user.nearAccountId).toMatch(/^p-tester[0-9a-f]{6}\.game\.mock\.testnet$/);
    expect([user.keyVersion, user.points, user.bootstrapPending, user.bootstrapClaimedAt]).toEqual([
      1,
      1000,
      null,
      null,
    ]);
    expect(game.balances.get(user.nearAccountId)).toBe(1000n);
    expect(drone).toMatchObject({
      tokenId: game.first('drone'),
      level: 1,
      active: true,
      speed: 1,
      appliedSkinId: skin.id,
      appliedModId: mod.id,
    });
    expect(skin).toMatchObject({
      tokenId: game.first('skin'),
      template: 4,
      name: 'Ember',
      rarity: 'common',
    });
    expect(mod).toMatchObject({
      tokenId: game.first('mod'),
      template: MOD_TEMPLATE,
      name: 'Quick Charge',
      rarity: 'common',
    });
    expect(
      await db.select().from(droneSkins).where(eq(droneSkins.droneId, drone.id))
    ).toMatchObject([{ skinId: skin.id, isEquipped: true }]);
    expect(await db.select().from(droneMods).where(eq(droneMods.droneId, drone.id))).toMatchObject([
      { modId: mod.id, isEquipped: true },
    ]);
    expect(game.tokens.get(String(game.first('skin')))?.boundTo).toBe(game.first('drone'));
    expect(game.tokens.get(String(game.first('mod')))?.boundTo).toBe(game.first('drone'));
    expect(
      game.count(
        'mint_item',
        (a) => a.kind === 'skin' && a.template === 4 && a.placeholder_name === null
      )
    ).toBe(1);

    // A call after done changes nothing.
    expect(await run(id, game)).toMatchObject({ state: 'done', busy: true });
    expect(game.count('create_player')).toBe(1);
  });

  it('resumes from account and mints only the missing pieces', async () => {
    const game = createFakeGame({ failOnce: { mint_item: (a) => a.kind === 'mod' } });
    const { id } = await newUser();

    expect((await run(id, game)).state).toBe('account');
    await expect(run(id, game)).rejects.toThrow(/injected failure in mint_item/);
    expect((await rows(id)).user.bootstrapState).toBe('account');

    expect((await untilDone(id, game)).state).toBe('done');
    expect(game.count('create_player')).toBe(1);
    expect(game.count('mint_drone')).toBe(1);
    expect(game.count('mint_item', (a) => a.kind === 'skin')).toBe(1);
    expect(game.count('mint_item', (a) => a.kind === 'mod')).toBe(2); // the failed attempt and the retry
    expect(game.count('mint_volts')).toBe(1);
    expect(await db.select().from(drones).where(eq(drones.userId, id))).toHaveLength(1);
  });

  it('adopts a mint whose outcome was unknown instead of minting again', async () => {
    const game = createFakeGame();
    const { id } = await newUser();
    let sends = 0;
    // create_player is the first send, mint_drone the second: it applies, then reports unknown.
    const original = game.near.createPlayerAccount.bind(game.near);
    game.near.createPlayerAccount = async (args) => {
      const created = await original(args);
      game.near.mock.failNextSend('applied');
      sends += 1;
      return created;
    };

    expect((await run(id, game)).state).toBe('account');
    await expect(run(id, game)).rejects.toThrow(/unknown outcome/);
    expect(sends).toBe(1);
    expect(await untilDone(id, game)).toMatchObject({ state: 'done' });
    expect(game.count('mint_drone')).toBe(1);
    expect((await rows(id)).drone.tokenId).toBe(game.first('drone'));
  });

  it('resumes from minted and binds only what is not bound yet', async () => {
    const game = createFakeGame({ failOnce: { bind: (a) => a.item.startsWith('m:') } });
    const { id } = await newUser();

    expect((await run(id, game)).state).toBe('account');
    expect((await run(id, game)).state).toBe('minted');
    await expect(run(id, game)).rejects.toThrow(/injected failure in bind/);
    expect((await rows(id)).user.bootstrapState).toBe('minted');
    const mintsAfterFirstRun =
      game.count('mint_drone') + game.count('mint_item') + game.count('mint_volts');

    expect((await run(id, game)).state).toBe('done');
    expect(game.count('mint_drone') + game.count('mint_item') + game.count('mint_volts')).toBe(
      mintsAfterFirstRun
    );
    expect(game.count('bind', (a) => a.item.startsWith('s:'))).toBe(1);
    expect(game.count('bind', (a) => a.item.startsWith('m:'))).toBe(2);
    const { drone, mod } = await rows(id);
    expect(drone.appliedModId).toBe(mod.id);
  });

  it('stores bootstrap_pending on an unknown create_player outcome and resolves it without a second create', async () => {
    const game = createFakeGame();
    const { id, slug } = await newUser();
    game.near.mock.failNextSend('applied');

    await expect(run(id, game)).rejects.toBeInstanceOf(BootstrapPendingError);
    const { user } = await rows(id);
    expect(user.bootstrapState).toBe('none');
    expect(user.bootstrapPending).toEqual([
      expect.objectContaining({ accountId: `p-${slug}.game.mock.testnet`, slug, keyVersion: 1 }),
    ]);

    expect((await run(id, game)).state).toBe('account');
    expect(game.count('create_player')).toBe(1);
    expect((await untilDone(id, game)).state).toBe('done');
    const after = (await rows(id)).user;
    expect(after.nearAccountId).toBe(`p-${slug}.game.mock.testnet`);
    expect(after.playKeyEnc).toBe(user.bootstrapPending[0].playKeyEnc);
    expect(after.bootstrapPending).toBeNull();
  });

  it('drops a stored attempt whose create_player failed and creates under a suffixed slug', async () => {
    const game = createFakeGame();
    const { id, slug } = await newUser();
    // Another player took the slug, so the stored attempt executed and panicked `exists`.
    const taken = await game.near.createPlayerAccount({ slug, isTeam: false });
    const failedTx = 'mocktx-failed-create';
    await db
      .update(users)
      .set({
        bootstrapPending: [
          {
            accountId: taken.accountId,
            playKeyEnc: 'p',
            adminKeyEnc: 'a',
            keyVersion: 1,
            txHash: failedTx,
            slug,
          },
        ],
      })
      .where(eq(users.id, id));
    const resolve = game.near.resolveOutcome.bind(game.near);
    game.near.resolveOutcome = async (accountId, seq, txHash, options) => {
      if (txHash === failedTx)
        throw new ContractPanicError('exists', { method: 'create_player', txHash });
      return resolve(accountId, seq, txHash, options);
    };

    expect((await untilDone(id, game)).state).toBe('done');

    const { user } = await rows(id);
    expect(user.nearAccountId).toMatch(
      new RegExp(`^p-${slug}[0-9a-f]{4}\\.game\\.mock\\.testnet$`)
    );
    expect(user.nearAccountId).not.toBe(taken.accountId);
    expect(user.bootstrapPending).toBeNull();
  });

  it('two concurrent calls on a fresh user make exactly one create_player', async () => {
    const game = createFakeGame();
    const { id } = await newUser();

    const results = await Promise.all([run(id, game), run(id, game)]);

    expect(game.count('create_player')).toBe(1);
    // Overlapping calls: one acts, the other is busy. Back to back: the second takes the released
    // lease and makes the next step. Either way no step runs twice.
    const advanced = results.filter((r) => !r.busy).map((r) => r.state);
    expect([['account'], ['account', 'minted']]).toContainEqual(advanced.sort());
    expect((await untilDone(id, game)).state).toBe('done');
    expect(game.count('create_player')).toBe(1);
    const owned = await db
      .select()
      .from(drones)
      .where(and(eq(drones.userId, id)));
    expect(owned).toHaveLength(1);
  });
});
