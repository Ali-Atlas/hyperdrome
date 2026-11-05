/**
 * Team seeding (services/team-seed.service.js) against the fake contract and the test database.
 * Run from tests/teams/teams.test.js.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { calculatePerStatCap, calculateTSB } from '../../lib/game-engine/economy.js';
import { STAT_KEYS } from '../../lib/game-engine/templates.js';
import { TEAMS, teamDroneName } from '../../lib/teams/roster.js';
import { SeedBlockedError, seedTeam } from '../../services/team-seed.service.js';
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
    // Ember equips on tier 1; Cobalt has no tier render, so it is bound and not equipped.
    expect([skinsOf(0), skinsOf(1), skinsOf(2)]).toEqual([[[4, true]], [[2, false]], []]);

    const sends = near.mock.calls.filter((c) => c.kind !== 'view').length;
    const again = await seedTeam(def, { db, near, fund });
    expect(again).toMatchObject({ skipped: true, txs: [] });
    expect(near.mock.calls.filter((c) => c.kind !== 'view')).toHaveLength(sends);
    expect(funding).toHaveLength(1);

    // The rotated key is the one stored: the team can act with it.
    const flagship = { drone: fleet[2].tokenId, item: null, kind: 'mod' };
    await near.callAsPlayer(account, user.playKeyEnc, 'equip', flagship);
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
});
