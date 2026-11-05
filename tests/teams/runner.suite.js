/**
 * The team runner (services/teams.service.js) against the fake contract and the test database,
 * with teams seeded by the real seed service. Run from tests/teams/teams.test.js.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../lib/db/index.js';
import { calculateTSB } from '../../lib/game-engine/economy.js';
import { STAT_KEYS } from '../../lib/game-engine/templates.js';
import { CHAIN_ERRORS } from '../../lib/http/chain-errors.js';
import { teamActionId } from '../../lib/teams/action-id.js';
import { runTeamPhase } from '../../services/teams.service.js';
import { TEST_SECRET_KEY, dbEnabled, testDb } from '../gameplay/setup.js';
import { createTeamChain } from './fake-chain.js';
import {
  equippedMod,
  listedByPlayer,
  matchup,
  seedTestTeam,
  testTeam,
  wipeTeams,
} from './setup.js';

const { actions, drones, mods, droneMods, marketplaceListings } = schema;

/** Track ids (SPEC.md 2.9): Meridian has 4 straights and 4 turns, Crossfire 3 and 5. */
const MERIDIAN = 4;
const CROSSFIRE = 6;

describe.skipIf(!dbEnabled)('team runner', () => {
  const db = testDb();
  beforeEach(() => wipeTeams(db));
  afterAll(async () => {
    await wipeTeams(db);
    await db?.$client?.end?.();
  });

  /**
   * A chain with one seeded team, and `tick(slot, matchups)` returning that team's result.
   * @param {{ levelUp?: boolean }} [options] `levelUp`: the level 5 drone reaches level 6 (20 points of TSB headroom)
   */
  async function oneTeam({ levelUp = false } = {}) {
    const chain = createTeamChain();
    const def = testTeam();
    const team = await seedTestTeam(db, chain, def);
    const [, middle, flagship] = team.drones;
    /** The level 5 drone reaches level 6, as a settled race would do it. */
    const toLevel6 = async () => {
      /** @type {any} */ (chain.drones.get(middle.tokenId)).level = 6;
      await db.update(drones).set({ level: 6 }).where(eq(drones.id, middle.id));
    };
    if (levelUp) await toLevel6();
    /** @param {number} template */
    const modToken = (template) =>
      [...chain.items].find(([, i]) => i.kind === 'mod' && i.template === template)?.[0];
    /**
     * @param {number} slot
     * @param {ReturnType<typeof matchup>[]} matchups
     */
    const tick = async (slot, matchups) => {
      const res = await runTeamPhase(
        { slot, matchups, deadlineMs: Number.MAX_SAFE_INTEGER },
        { db, near: chain.near, secretKey: TEST_SECRET_KEY, sleep: async () => {} }
      );
      expect(res.teams).toHaveLength(1);
      return res.teams[0];
    };
    /** The team's unbound mods in the cache, by token. */
    const freeMods = async () => {
      const rows = await db
        .select({ token: mods.tokenId, template: mods.template })
        .from(mods)
        .leftJoin(droneMods, eq(droneMods.modId, mods.id))
        .where(and(eq(mods.userId, team.user.id), isNull(droneMods.id)));
      return new Map(
        rows.map((/** @type {{ token: string, template: number }} */ r) => [r.template, r.token])
      );
    };
    return { chain, def, ...team, middle, flagship, modToken, tick, freeMods, toLevel6 };
  }

  it('takes equip, bind, allocate, capsule and list in that order, one action per tick', async () => {
    const t = await oneTeam();
    const { chain, flagship, middle } = t;
    // On Crossfire the unequipped Light Frame (0.2875) fits better than Aero Shell (0.125).
    const race = [matchup(flagship.tokenId, CROSSFIRE)];
    let sent = chain.playerCalls().length;
    /** Player transactions since the last check. */
    const newCalls = () => {
      const calls = chain.playerCalls().slice(sent);
      sent += calls.length;
      return calls.map((c) => c.method);
    };
    /** The team's mods of a template on the fake chain, oldest first. */
    const minted = (/** @type {number} */ template) =>
      [...chain.items].filter(([, i]) => i.template === template).map(([token]) => token);

    // Equip is due, and so is a capsule (Volts): only the first is taken.
    expect(await t.tick(1000, race)).toMatchObject({
      step: 'equip',
      subject: flagship.tokenId,
      outcome: 'applied',
      replayed: false,
    });
    expect(newCalls()).toEqual(['equip']);
    expect(await equippedMod(db, flagship.id)).toBe(t.modToken(9));

    // Grip Pads, Steady Module, Typhoon Module.
    chain.draw([2, 5, 21]);
    expect(await t.tick(1001, race)).toMatchObject({ step: 'capsule', subject: 'starter' });
    expect(newCalls()).toEqual(['open_pack', 'reveal_pack']);

    // Grip Pads (0.4375) beats the flagship's best bound mod, and the level 5 drone has gained
    // a level: bind comes before allocate, and the equip follows on the next tick.
    await t.toLevel6();
    const [gripPads] = minted(2);
    expect(await t.tick(1002, race)).toMatchObject({ step: 'bind', subject: gripPads });
    expect(chain.playerCalls('bind').at(-1)?.args).toMatchObject({
      drone: flagship.tokenId,
      item: gripPads,
    });
    expect(await equippedMod(db, flagship.id)).toBe(t.modToken(9));
    expect(await t.tick(1003, race)).toMatchObject({ step: 'equip', subject: flagship.tokenId });
    expect(await equippedMod(db, flagship.id)).toBe(gripPads);
    expect(newCalls()).toEqual(['bind', 'equip']);

    expect(await t.tick(1004, race)).toMatchObject({ step: 'allocate', subject: middle.tokenId });
    expect(newCalls()).toEqual(['allocate_stats']);
    const [raised] = await db.select().from(drones).where(eq(drones.id, middle.id));
    expect(STAT_KEYS.reduce((sum, key) => sum + raised[key], 0)).toBe(calculateTSB(6));

    // Two more capsules of mods that beat nothing (Quick Charge, Steady Module, Typhoon Module)
    // take the team to 8 unbound mods; none is bound.
    chain.draw([3, 5, 21]);
    chain.draw([3, 5, 21]);
    expect(await t.tick(1005, race)).toMatchObject({ step: 'capsule' });
    expect(await t.tick(1006, race)).toMatchObject({ step: 'capsule' });
    expect(newCalls()).toEqual(['open_pack', 'reveal_pack', 'open_pack', 'reveal_pack']);
    expect(chain.playerCalls('bind')).toHaveLength(4);

    // 6 or more unbound mods: no more capsules. The lowest fit is listed, never a bound mod:
    // the Typhoon Modules (-0.9375), epic, the lower token number first.
    const typhoons = minted(21);
    expect(await t.tick(1007, race)).toMatchObject({ step: 'list', subject: typhoons[0] });
    expect(chain.playerCalls('list').at(-1)?.args).toMatchObject({
      token: typhoons[0],
      price: '4200',
    });
    expect(await t.tick(1008, race)).toMatchObject({ step: 'list', subject: typhoons[1] });
    expect(newCalls()).toEqual(['list', 'list']);
    const listed = await db
      .select({ token: marketplaceListings.tokenId })
      .from(marketplaceListings)
      .where(
        and(eq(marketplaceListings.sellerId, t.user.id), eq(marketplaceListings.status, 'active'))
      );
    expect(listed.map((/** @type {any} */ l) => l.token).sort()).toEqual(
      typhoons.slice(0, 2).sort()
    );
  });

  it('buys a listed mod that beats a drone by 2 fit at or under 0.8x base, within its spare Volts', async () => {
    const t = await oneTeam();
    const { chain, flagship } = t;
    // 700 Volts above the reserve: under a capsule's price, enough for the 600 listing.
    chain.volts.set(t.accountId, 5_700);
    // Meridian at night: Aero Shell stays (0.5); a Predator Lens fits 4, a Night Optics 2.
    const race = [matchup(flagship.tokenId, MERIDIAN, 'clear', 'night')];
    const bargain = await listedByPlayer(db, chain, 22, 600);
    await listedByPlayer(db, chain, 14, 100);
    await listedByPlayer(db, chain, 22, 2_900);

    expect(await t.tick(4000, race)).toMatchObject({
      step: 'buy',
      subject: bargain,
      outcome: 'applied',
    });
    expect(chain.volts.get(t.accountId)).toBe(5_100);
    const [bought] = await db.select().from(mods).where(eq(mods.tokenId, bargain));
    expect(bought.userId).toBe(t.user.id);
    const [sale] = await db
      .select()
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tokenId, bargain));
    expect(sale).toMatchObject({ status: 'sold', buyerId: t.user.id });
    // The bought mod is bound to the drone it beats, then equipped, one action per tick.
    expect(await t.tick(4001, race)).toMatchObject({ step: 'bind', subject: bargain });
    expect(await t.tick(4002, race)).toMatchObject({ step: 'equip', subject: flagship.tokenId });
    expect(await equippedMod(db, flagship.id)).toBe(bargain);
    // 100 Volts left to spend: Night Optics no longer gains 2 on anything, so nothing happens.
    expect(await t.tick(4003, race)).toMatchObject({ step: null, outcome: 'idle' });
  });

  it('replays the same action id when a slot runs again, and finishes an unknown outcome first', async () => {
    const t = await oneTeam({ levelUp: true });
    const { chain, flagship } = t;
    const race = [matchup(flagship.tokenId, CROSSFIRE)];
    const before = chain.playerCalls().length;
    const id = teamActionId(t.def.slug, 2000, 'equip', flagship.tokenId);

    // The equip lands but its answer is lost: the action stays pending under its id.
    chain.near.mock.failNextSend('applied');
    expect(await t.tick(2000, race)).toMatchObject({
      step: 'equip',
      actionId: id,
      outcome: 'pending',
    });
    // The same slot again: the same id, resolved by its hash, nothing sent.
    expect(await t.tick(2000, race)).toMatchObject({
      step: 'equip',
      actionId: id,
      outcome: 'applied',
      replayed: true,
    });
    // And again: allocate is due by now, but the slot's action is already recorded.
    expect(await t.tick(2000, race)).toMatchObject({
      step: 'equip',
      actionId: id,
      outcome: 'applied',
      replayed: true,
    });
    expect(
      chain
        .playerCalls()
        .slice(before)
        .map((c) => c.method)
    ).toEqual(['equip']);
    const rows = await db.select().from(actions).where(eq(actions.userId, t.user.id));
    expect(rows.map((/** @type {any} */ r) => [r.id, r.status])).toEqual([[id, 'applied']]);

    // An unknown outcome left by one slot is finished by the next, before any new decision.
    chain.near.mock.failNextSend('applied');
    const pending = await t.tick(2001, race);
    expect(pending).toMatchObject({ step: 'allocate', outcome: 'pending' });
    expect(pending.actionId).not.toBe(id);
    expect(await t.tick(2002, race)).toMatchObject({
      step: 'allocate',
      actionId: pending.actionId,
      outcome: 'applied',
      replayed: true,
    });
    expect(await t.tick(2003, race)).toMatchObject({ step: 'capsule', replayed: false });
    expect(chain.playerCalls('allocate_stats')).toHaveLength(1);
  });

  it('a cap exceeded or insufficient volts answer ends the turn; the next tick passes the refused plan over', async () => {
    const t = await oneTeam({ levelUp: true });
    const { chain, flagship } = t;
    // Aero Shell is the best mod on Meridian, so the turn starts at allocate.
    const race = [matchup(flagship.tokenId, MERIDIAN)];
    const before = chain.playerCalls().length;

    chain.refuse('allocate_stats', 'cap exceeded');
    const refused = await t.tick(3000, race);
    expect(refused).toMatchObject({
      step: 'allocate',
      outcome: 'refused',
      error: CHAIN_ERRORS['cap exceeded'].error,
    });
    // The capsule the team could afford is not tried, and the same slot again sends nothing.
    expect(await t.tick(3000, race)).toMatchObject({
      actionId: refused.actionId,
      outcome: 'refused',
      replayed: true,
    });
    expect(
      chain
        .playerCalls()
        .slice(before)
        .map((c) => c.method)
    ).toEqual(['allocate_stats']);

    // The next tick passes over the plan that was just refused and takes the next step instead.
    chain.refuse('allocate_stats', 'insufficient volts');
    expect(await t.tick(3001, race)).toMatchObject({ step: 'capsule', outcome: 'applied' });
    // With the capsule as its latest action the team tries allocate again; refused, turn over.
    expect(await t.tick(3002, race)).toMatchObject({
      step: 'allocate',
      outcome: 'refused',
      error: CHAIN_ERRORS['insufficient volts'].error,
    });
    expect(
      chain
        .playerCalls()
        .slice(before)
        .map((c) => c.method)
    ).toEqual(['allocate_stats', 'open_pack', 'reveal_pack', 'allocate_stats']);
  });

  it('finishes a capsule that was committed and not revealed before deciding anything new', async () => {
    const t = await oneTeam();
    const { chain } = t;
    chain.draw([2, 5, 21]);
    // The commit applies and burns 1,000 Volts; the reveal is refused as too early, twice.
    chain.refuse('reveal_pack', 'too early');
    const opened = await t.tick(6000, []);
    expect(opened).toMatchObject({ step: 'capsule', subject: 'starter', outcome: 'refused' });
    expect(chain.volts.get(t.accountId)).toBe(19_000);
    expect((await t.freeMods()).size).toBe(0);

    // The next tick reveals that capsule under its own id: no second commit, the 3 mods arrive.
    chain.refuse('reveal_pack', null);
    expect(await t.tick(6001, [])).toMatchObject({
      step: 'capsule',
      actionId: opened.actionId,
      outcome: 'applied',
      replayed: true,
    });
    expect(chain.playerCalls('open_pack')).toHaveLength(1);
    expect(chain.volts.get(t.accountId)).toBe(19_000);
    expect([...(await t.freeMods()).keys()].sort((a, b) => a - b)).toEqual([2, 5, 21]);
    // Then the team decides again.
    expect(await t.tick(6002, [])).toMatchObject({ step: 'capsule', replayed: false });
    expect(chain.playerCalls('open_pack')).toHaveLength(2);
  });

  it('skips the teams left when the deadline passes, and rotates which team goes first', async () => {
    const chain = createTeamChain();
    const a = await seedTestTeam(db, chain, testTeam());
    const b = await seedTestTeam(db, chain, testTeam());
    /** The first team starts in time; the clock is past the deadline when the second is due. */
    const clock = () => {
      let reads = 0;
      return () => (reads++ === 0 ? 0 : 5_000);
    };
    /** @param {number} slot */
    const tick = (slot) =>
      runTeamPhase(
        { slot, matchups: [], deadlineMs: 1_000 },
        { db, near: chain.near, secretKey: TEST_SECRET_KEY, now: clock() }
      );

    const first = await tick(5000);
    expect(first.teams.map((r) => r.outcome)).toEqual(['applied', 'deadline']);
    expect(first.teams[0]).toMatchObject({ step: 'capsule', subject: 'starter' });
    const skipped = [a, b].find((x) => x.accountId.startsWith(`${first.teams[1].team}.`));
    expect(
      await db.select().from(actions).where(eq(actions.userId, skipped?.user.id))
    ).toHaveLength(0);

    const second = await tick(5001);
    expect(second.teams.map((r) => r.outcome)).toEqual(['applied', 'deadline']);
    expect(second.teams[0].team).toBe(first.teams[1].team);
  });
});
