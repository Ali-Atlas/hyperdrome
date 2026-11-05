import { describe, expect, it } from 'vitest';
import { ContractPanicError, RpcUnknownOutcomeError } from '../../lib/near/errors.js';
import { createMockNear } from '../../lib/near/mock.js';

describe('mock adapter', () => {
  it('creates players with seq 0 and sends seq + 1 on every player call', async () => {
    const near = createMockNear();
    const { accountId, playKeyEnc, keyVersion } = await near.createPlayerAccount({
      slug: 'alice',
      isTeam: false,
    });
    expect([accountId, keyVersion]).toEqual(['p-alice.game.mock.testnet', 1]);
    expect(await near.view('get_player', { account: accountId })).toMatchObject({
      seq: 0,
      is_team: false,
    });
    await near.callAsPlayer(accountId, playKeyEnc, 'bind', { drone: 'd:1', item: 'm:1' });
    await near.callAsPlayer(accountId, playKeyEnc, 'equip', {
      drone: 'd:1',
      item: null,
      kind: 'mod',
    });
    expect(near.mock.player(accountId)?.seq).toBe(2);
    expect(await near.nextSeq(accountId)).toBe(3);
    expect(near.mock.calls.filter((c) => c.kind === 'player').map((c) => c.args.seq)).toEqual([
      1, 2,
    ]);
  });

  it('panics like the contract: bad seq, not player, not owner, exists', async () => {
    const near = createMockNear();
    const { accountId, playKeyEnc } = await near.createPlayerAccount({
      slug: 'bob',
      isTeam: false,
    });
    expect(() => near.mock.applyPlayerCall(accountId, 'bind', { seq: 5 })).toThrow(
      ContractPanicError
    );
    expect(() => near.mock.applyPlayerCall(accountId, 'bind', { seq: 5 })).toThrow(/bad seq/);
    expect(() =>
      near.mock.applyPlayerCall('p-ghost.game.mock.testnet', 'bind', { seq: 1 })
    ).toThrow(/not player/);
    await expect(
      near.callAsPlayer(accountId, playKeyEnc, 'mint_volts', { to: accountId })
    ).rejects.toMatchObject({ panic: 'not owner' });
    await expect(near.createPlayerAccount({ slug: 'bob', isTeam: false })).rejects.toMatchObject({
      panic: 'exists',
    });
    await expect(near.createPlayerAccount({ slug: 'B!', isTeam: false })).rejects.toMatchObject({
      panic: 'bad slug',
    });
  });

  it('rejects a play key sealed for another account', async () => {
    const near = createMockNear();
    const a = await near.createPlayerAccount({ slug: 'carol', isTeam: false });
    const b = await near.createPlayerAccount({ slug: 'dave', isTeam: false });
    await expect(near.callAsPlayer(b.accountId, a.playKeyEnc, 'bind', {})).rejects.toThrow();
  });

  it('resolveOutcome reports an applied send after an unknown outcome, and a lost one as not applied', async () => {
    const near = createMockNear();
    const { accountId, playKeyEnc } = await near.createPlayerAccount({
      slug: 'erin',
      isTeam: false,
    });

    near.mock.failNextSend('applied');
    const applied = await near.callAsPlayer(accountId, playKeyEnc, 'bind', {}).catch((e) => e);
    expect(applied).toBeInstanceOf(RpcUnknownOutcomeError);
    expect(await near.resolveOutcome(accountId, applied.seq, applied.txHash)).toMatchObject({
      applied: true,
      txHash: applied.txHash,
    });

    near.mock.failNextSend('lost');
    const lost = await near.callAsPlayer(accountId, playKeyEnc, 'bind', {}).catch((e) => e);
    expect(lost.seq).toBe(2);
    expect(await near.resolveOutcome(accountId, lost.seq, lost.txHash)).toEqual({ applied: false });
    expect(near.mock.player(accountId)?.seq).toBe(1);
  });

  it('rotatePlayKey issues a new play key, bumps the version and retires the old key', async () => {
    const near = createMockNear();
    const { accountId, playKeyEnc, adminKeyEnc } = await near.createPlayerAccount({
      slug: 'frank',
      isTeam: true,
    });
    expect(accountId).toBe('frank.game.mock.testnet');
    const rotated = await near.rotatePlayKey(accountId, adminKeyEnc, { keyVersion: 1 });
    expect(rotated.keyVersion).toBe(2);
    await expect(near.callAsPlayer(accountId, playKeyEnc, 'bind', {})).rejects.toThrow();
    await near.callAsPlayer(accountId, rotated.playKeyEnc, 'bind', {});
    await expect(near.rotatePlayKey(accountId, playKeyEnc)).rejects.toThrow();
  });

  it('runs handlers for results and events, and logs ops and settlement calls', async () => {
    const near = createMockNear({ constants: { laps: 3 } });
    near.mock.on('mint_drone', () => ({ result: 'd:9', events: [] }));
    near.mock.on('commit_batch', () => ({}));
    expect((await near.callAsOps('mint_drone', { owner: 'x' })).result).toBe('d:9');
    await near.callAsSettlement('commit_batch', { batch_id: 1 });
    expect(await near.getConstants()).toEqual({ laps: 3 });
    expect(near.mock.calls.map((c) => c.kind)).toEqual(['ops', 'settlement']);
  });
});
