/**
 * Team seeding (services/team-seed.service.js) against the fake contract and the test database.
 * Run from tests/teams/teams.test.js.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { calculatePerStatCap, calculateTSB } from '../../lib/game-engine/economy.js';
import { STAT_KEYS } from '../../lib/game-engine/templates.js';
import { ROGUE_FIXTURE } from '../../lib/teams/fixtures.js';
import { TEAMS, teamDroneName } from '../../lib/teams/roster.js';
import { UNKNOWN_MINT_WAIT_MS } from '../../services/team-seed-kit.js';
import { SeedBlockedError, nearText, seedTeam } from '../../services/team-seed.service.js';
import { dbEnabled, testDb } from '../gameplay/setup.js';
import { createTeamChain } from './fake-chain.js';
import { NEAR, testTeam, wipeTeams } from './setup.js';

const { users, teams, drones, mods, skins, droneMods, droneSkins } = schema;

describe.skipIf(!dbEnabled)('team seeding', () => {
  const db = testDb();
  beforeEach(() => wipeTeams(db));
  afterAll(() => wipeTeams(db));

  it('seeds account, budget, kit, binds, Volts, gas and key, and a second run sends nothing', async () => {
    const chain = createTeamChain();
    const { near } = chain;
    const def = testTeam({ skins: TEAMS[0].skins, mods: TEAMS[0].mods });
    near.mock.setBalance(near.ownerId, 50n * NEAR);
    /** @type {{ accountId: string, from: string, yocto: bigint }[]} */
    const funding = [];
    /** @type {import('../../services/team-seed.service.js').Fund} */
    const fund = async (request) => {
      funding.push(request);
      near.mock.setBalance(request.accountId, request.yocto + NEAR / 20n);
    };

    const seeded = await seedTeam(def, { db, near, fund });
    const account = `${def.slug}.${near.gameId}`;
    expect(seeded).toMatchObject({ team: def.slug, accountId: account, skipped: false });
    expect(funding).toEqual([{ accountId: account, from: near.ownerId, yocto: 2n * NEAR }]);

    const count = (/** @type {string} */ method) => chain.calls(method).length;
    expect(chain.calls('create_player')[0].args).toEqual({ slug: def.slug, is_team: true });
    expect(chain.calls('set_team_budget').map((c) => c.args)).toEqual([
      { account, per_tx: '5000', per_day: '15000' },
    ]);
    expect([count('mint_drone'), count('mint_item'), count('bind')]).toEqual([3, 5, 5]);
    expect(chain.calls('mint_volts').map((c) => c.args)).toEqual([
      { to: account, amount: '20000' },
    ]);
    expect(chain.calls('rotate_play_key').map((c) => c.args)).toEqual([
      { key_version: 1, allowance: String(2n * NEAR) },
    ]);
    expect(seeded.txs).toHaveLength(1 + 1 + 3 + 5 + 1 + 5 + 1);

    const [user] = await db.select().from(users).where(eq(users.nearAccountId, account));
    expect(user).toMatchObject({
      isTeam: true,
      username: def.name,
      bootstrapState: 'done',
      keyVersion: 2,
      points: 20_000,
    });
    const [team] = await db.select().from(teams).where(eq(teams.userId, user.id));
    expect(team).toMatchObject({ name: def.name, persona: def.weights, reserve: '5000' });

    const fleet = await db.select().from(drones).where(eq(drones.userId, user.id));
    fleet.sort((/** @type {any} */ a, /** @type {any} */ b) => a.level - b.level);
    expect(fleet.map((/** @type {any} */ d) => [d.name, d.level, d.active])).toEqual(
      [4, 5, 8].map((level, i) => [teamDroneName(def, i), level, true])
    );
    for (const drone of fleet) {
      const stats = STAT_KEYS.map((key) => drone[key]);
      expect(stats.reduce((a, b) => a + b, 0)).toBe(calculateTSB(drone.level));
      expect(Math.max(...stats)).toBeLessThanOrEqual(calculatePerStatCap(drone.level));
      // Vortex: speed leads.
      expect(drone.speed).toBe(Math.max(...stats));
    }

    const bound = await db
      .select({ droneId: droneMods.droneId, template: mods.template, on: droneMods.isEquipped })
      .from(droneMods)
      .innerJoin(mods, eq(mods.id, droneMods.modId));
    /** @param {number} i drone index */
    const modsOf = (i) =>
      bound
        .filter((/** @type {any} */ b) => b.droneId === fleet[i].id)
        .map((/** @type {any} */ b) => [b.template, b.on])
        .sort((/** @type {any[]} */ x, /** @type {any[]} */ y) => x[0] - y[0]);
    // Aero Shell (11) was bound first on the level 8 drone, so it is the equipped one.
    expect([modsOf(0), modsOf(1), modsOf(2)]).toEqual([
      [],
      [[1, true]],
      [
        [9, false],
        [11, true],
      ],
    ]);
    const worn = await db
      .select({ droneId: droneSkins.droneId, template: skins.template, on: droneSkins.isEquipped })
      .from(droneSkins)
      .innerJoin(skins, eq(skins.id, droneSkins.skinId));
    const skinsOf = (/** @type {number} */ i) =>
      worn
        .filter((/** @type {any} */ s) => s.droneId === fleet[i].id)
        .map((/** @type {any} */ s) => [s.template, s.on]);
    // Dusk and Cobalt have no tier render (SPEC 2.6), so they are bound and not equipped.
    expect([skinsOf(0), skinsOf(1), skinsOf(2)]).toEqual([[[3, false]], [[2, false]], []]);

    const sends = near.mock.calls.filter((c) => c.kind !== 'view').length;
    const again = await seedTeam(def, { db, near, fund });
    expect(again).toMatchObject({ skipped: true, txs: [] });
    expect(near.mock.calls.filter((c) => c.kind !== 'view')).toHaveLength(sends);
    expect(funding).toHaveLength(1);

    // The rotated key is the one stored: the team can act with it.
    const flagship = { drone: fleet[2].tokenId, item: null, kind: 'mod' };
    await near.callAsPlayer(account, user.playKeyEnc, 'equip', flagship);
  });

  it('seeds a fixture with its own caps, kit, Volts and gas, and leaves it out of the team phase', async () => {
    const chain = createTeamChain();
    const { near } = chain;
    const def = testTeam({ skins: [], mods: ROGUE_FIXTURE.mods, fixture: ROGUE_FIXTURE.fixture });
    near.mock.setBalance(near.ownerId, 50n * NEAR);
    /** @type {bigint[]} */
    const funding = [];
    /** @type {import('../../services/team-seed.service.js').Fund} */
    const fund = async ({ accountId, yocto }) => {
      funding.push(yocto);
      near.mock.setBalance(accountId, yocto);
    };

    const seeded = await seedTeam(def, { db, near, fund });
    const account = `${def.slug}.${near.gameId}`;
    expect(seeded).toMatchObject({ accountId: account, skipped: false });
    expect(chain.calls('create_player')[0].args).toEqual({ slug: def.slug, is_team: true });
    expect(chain.calls('set_team_budget').map((c) => c.args)).toEqual([
      { account, per_tx: '500', per_day: '1000' },
    ]);
    expect(chain.calls('mint_drone').map((c) => [c.args.level, c.args.stats])).toEqual([
      [20, STAT_KEYS.map(() => 1)],
      [20, STAT_KEYS.map(() => 1)],
    ]);
    expect(chain.calls('mint_volts').map((c) => c.args)).toEqual([{ to: account, amount: '5000' }]);
    expect(funding).toEqual([NEAR]);
    expect(chain.calls('rotate_play_key').map((c) => c.args)).toEqual([
      { key_version: 1, allowance: String(NEAR) },
    ]);
    expect(seeded.txs.map((t) => t.step)).toContain(
      'rotatePlayKey to a 1 NEAR allowance (key version 2)'
    );

    const [user] = await db.select().from(users).where(eq(users.nearAccountId, account));
    expect(user).toMatchObject({ isTeam: true, bootstrapState: 'done', points: 5_000 });
    expect(await db.select().from(teams).where(eq(teams.userId, user.id))).toEqual([]);
    const fleet = await db.select().from(drones).where(eq(drones.userId, user.id));
    expect(fleet.map((/** @type {any} */ d) => [d.level, d.active])).toEqual([
      [20, false],
      [20, false],
    ]);
    const bound = await db
      .select({ droneId: droneMods.droneId, on: droneMods.isEquipped })
      .from(droneMods)
      .innerJoin(drones, eq(drones.id, droneMods.droneId))
      .where(eq(drones.userId, user.id));
    expect(bound).toHaveLength(1);
    expect(bound[0].on).toBe(true);

    const sends = near.mock.calls.filter((c) => c.kind !== 'view').length;
    expect(await seedTeam(def, { db, near, fund })).toMatchObject({ skipped: true });
    expect(near.mock.calls.filter((c) => c.kind !== 'view')).toHaveLength(sends);
  });

  it('formats NEAR amounts for the gas messages', () => {
    expect([2n * NEAR, NEAR, NEAR / 2n, NEAR / 20n].map(nearText)).toEqual([
      '2 NEAR',
      '1 NEAR',
      '0.5 NEAR',
      '0.05 NEAR',
    ]);
  });

  it('stops before the gas transfer when the owner holds under 10 NEAR, and resumes without minting twice', async () => {
    const chain = createTeamChain();
    const { near } = chain;
    const def = testTeam();
    near.mock.setBalance(near.ownerId, 9n * NEAR);
    let asked = 0;
    /** @type {import('../../services/team-seed.service.js').Fund} */
    const fund = async ({ accountId, yocto }) => {
      asked += 1;
      near.mock.setBalance(accountId, yocto);
    };

    await expect(seedTeam(def, { db, near, fund })).rejects.toBeInstanceOf(SeedBlockedError);
    expect(asked).toBe(0);
    expect(chain.calls('rotate_play_key')).toHaveLength(0);
    const [stopped] = await db.select().from(users).where(eq(users.username, def.name));
    expect(stopped).toMatchObject({ bootstrapState: 'minted', keyVersion: 1 });

    near.mock.setBalance(near.ownerId, 10n * NEAR);
    const resumed = await seedTeam(def, { db, near, fund });
    expect(resumed.skipped).toBe(false);
    expect(asked).toBe(1);
    expect(resumed.txs.map((t) => t.step)).toEqual([
      'rotatePlayKey to a 2 NEAR allowance (key version 2)',
    ]);
    expect(
      ['mint_drone', 'mint_item', 'mint_volts', 'bind'].map((m) => chain.calls(m).length)
    ).toEqual([3, 3, 1, 3]);
  });

  /**
   * A chain and a team definition, with the owner funded and `fund` granting the gas float.
   */
  function setup() {
    const chain = createTeamChain();
    const { near } = chain;
    near.mock.setBalance(near.ownerId, 50n * NEAR);
    /** @type {import('../../services/team-seed.service.js').Fund} */
    const fund = async ({ accountId, yocto }) => near.mock.setBalance(accountId, yocto);
    const def = testTeam();
    const row = async () => (await db.select().from(users).where(eq(users.username, def.name)))[0];
    return { chain, near, fund, def, row };
  }

  it('keeps the keys of a create that lands when its answer is lost or the process dies', async () => {
    // The answer is lost: the keys are already stored, and the next run adopts the account.
    const lost = setup();
    lost.near.mock.failNextSend('applied');
    await expect(seedTeam(lost.def, { db, ...lost })).rejects.toBeInstanceOf(SeedBlockedError);
    const pending = await lost.row();
    expect(pending).toMatchObject({ bootstrapState: 'none', nearAccountId: null });
    expect(pending.bootstrapPending).toHaveLength(1);
    expect(pending.bootstrapPending[0]).toMatchObject({
      accountId: `${lost.def.slug}.${lost.near.gameId}`,
      txHash: lost.chain.calls('create_player')[0].txHash,
    });
    expect((await seedTeam(lost.def, { db, ...lost })).skipped).toBe(false);
    expect(lost.chain.calls('create_player')).toHaveLength(1);
    expect(await lost.row()).toMatchObject({ bootstrapState: 'done', bootstrapPending: null });

    // The process dies after the broadcast: the create lands, the call never returns.
    const died = setup();
    const { createPlayerAccount } = died.near;
    const dying = {
      ...died.near,
      createPlayerAccount: async (/** @type {any} */ input) => {
        await createPlayerAccount(input);
        throw new Error('killed');
      },
    };
    await expect(seedTeam(died.def, { db, near: dying, fund: died.fund })).rejects.toThrow();
    expect((await died.row()).bootstrapPending).toHaveLength(1);
    expect((await seedTeam(died.def, { db, ...died })).skipped).toBe(false);
    expect(died.chain.calls('create_player')).toHaveLength(1);
    // The stored keys are the account's: the binds were signed with them.
    expect(died.chain.calls('bind')).toHaveLength(3);
  });

  it('creates again when the first create never reached the chain', async () => {
    const t = setup();
    t.near.mock.failNextSend('lost');
    await expect(seedTeam(t.def, { db, ...t })).rejects.toBeInstanceOf(SeedBlockedError);
    expect(t.chain.calls('create_player')).toHaveLength(0);
    expect((await seedTeam(t.def, { db, ...t })).skipped).toBe(false);
    expect(t.chain.calls('create_player')).toHaveLength(1);
    expect(await t.row()).toMatchObject({ bootstrapState: 'done', bootstrapPending: null });
  });

  it('never mints a piece twice: a failed mint, an unknown one that landed, one that was lost', async () => {
    const t = setup();
    const { near, chain } = t;
    /** Fail the nth `mint_item` in `mode` (`refuse`: the contract panics). */
    const failing = (
      /** @type {number} */ nth,
      /** @type {'applied' | 'lost' | 'refuse'} */ mode
    ) => {
      let seen = 0;
      return {
        ...near,
        callAsOps: async (/** @type {string} */ method, /** @type {any} */ args) => {
          if (method === 'mint_item' && ++seen === nth) {
            if (mode === 'refuse') chain.refuse('mint_item', 'no supply');
            else near.mock.failNextSend(mode);
          }
          return near.callAsOps(method, args);
        },
      };
    };
    const counts = () =>
      ['mint_drone', 'mint_item', 'mint_volts'].map((m) => chain.calls(m).length);

    // The 1st item mint panics: 3 drones are minted and recorded, the panicking call is logged.
    await expect(seedTeam(t.def, { db, near: failing(1, 'refuse'), fund: t.fund })).rejects.toThrow(
      /no supply/
    );
    chain.refuse('mint_item', null);
    expect(counts()).toEqual([3, 1, 0]);
    expect(Object.keys((await t.row()).bootstrapPending.minted)).toEqual(['d0', 'd1', 'd2']);

    // The 2nd item mint of this run lands with its answer lost: resolved by hash on the next run.
    await expect(
      seedTeam(t.def, { db, near: failing(2, 'applied'), fund: t.fund })
    ).rejects.toBeInstanceOf(SeedBlockedError);
    expect(counts()).toEqual([3, 3, 0]);
    expect((await t.row()).bootstrapPending.unknown).toHaveLength(1);

    // The last item mint never reaches the chain: the seed waits, then mints it again.
    await expect(
      seedTeam(t.def, { db, near: failing(1, 'lost'), fund: t.fund })
    ).rejects.toBeInstanceOf(SeedBlockedError);
    expect(counts()).toEqual([3, 3, 0]);
    await expect(seedTeam(t.def, { db, ...t })).rejects.toThrow(/still has no outcome/);
    const later = Date.now() + UNKNOWN_MINT_WAIT_MS + 1;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    const done = await seedTeam(t.def, { db, ...t });
    clock.mockRestore();
    expect(done.skipped).toBe(false);
    // 3 drones, the 3 roster items (1 skin, 2 mods) and the Volts, each exactly once on chain.
    expect(counts()).toEqual([3, 4, 1]);
    expect([chain.drones.size, chain.items.size]).toEqual([3, 3]);
    expect(await t.row()).toMatchObject({ bootstrapState: 'done', bootstrapPending: null });
  });

  it('reconcile mints and binds what a changed roster adds, and never Volts, gas or key', async () => {
    const t = setup();
    const { chain } = t;
    await seedTeam(t.def, { db, ...t });
    const account = `${t.def.slug}.${t.near.gameId}`;
    // The team has played since: its balance is no longer the starting one.
    chain.volts.set(account, 12_345);
    // The roster gains Cobalt on the level 5 drone and Streamline Plate on the level 8 drone.
    const wider = {
      ...t.def,
      skins: [...t.def.skins, { template: 2, drone: 1 }],
      mods: [...t.def.mods, { template: 1, drone: 2 }],
    };
    const counts = () =>
      ['mint_drone', 'mint_item', 'mint_volts', 'bind', 'rotate_play_key', 'set_team_budget'].map(
        (m) => chain.calls(m).length
      );
    expect(counts()).toEqual([3, 3, 1, 3, 1, 1]);

    // Without the flag a finished team is left alone.
    expect((await seedTeam(wider, { db, ...t })).skipped).toBe(true);
    expect(counts()).toEqual([3, 3, 1, 3, 1, 1]);

    const done = await seedTeam(wider, { db, ...t, reconcile: true });
    expect(done.txs.map((x) => x.step.replace(/ [smd]:\d+/g, ''))).toEqual([
      'mint_item skin template 2 ->',
      'mint_item mod template 1 ->',
      'bind to',
      'bind to',
    ]);
    expect(counts()).toEqual([3, 5, 1, 5, 1, 1]);
    expect(chain.volts.get(account)).toBe(12_345);
    expect(await t.row()).toMatchObject({
      bootstrapState: 'done',
      bootstrapPending: null,
      keyVersion: 2,
      points: 12_345,
    });
    // The level 8 drone keeps Aero Shell equipped and has the new mod bound.
    const flagship = [...chain.drones.values()].find((d) => d.level === 8);
    expect(flagship?.mods).toHaveLength(3);
    expect(chain.items.get(String(flagship?.equipped.mod))?.template).toBe(11);
    const cached = await db
      .select({ template: mods.template, on: droneMods.isEquipped })
      .from(droneMods)
      .innerJoin(mods, eq(mods.id, droneMods.modId))
      .innerJoin(drones, eq(drones.id, droneMods.droneId))
      .where(eq(drones.userId, (await t.row()).id));
    expect(
      cached
        .map((/** @type {any} */ c) => [c.template, c.on])
        .sort((/** @type {any[]} */ x, /** @type {any[]} */ y) => x[0] - y[0])
    ).toEqual([
      [1, false],
      [9, false],
      [11, true],
    ]);
    // A second reconcile finds nothing to add.
    expect((await seedTeam(wider, { db, ...t, reconcile: true })).txs).toEqual([]);
  });
});
