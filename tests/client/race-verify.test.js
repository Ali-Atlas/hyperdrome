/**
 * The pure helpers of the browser race verification (SPEC.md 11): decoding a call's arguments from
 * an RPC transaction and picking the race's entry from the batch's two calls.
 */
import { describe, expect, it } from 'vitest';
import { decodeCallArgs, isThisRace, pickRaceEntry } from '../../lib/client/race-verify.js';
import { GAME_CONTRACT } from '../../lib/near/public-rpc.js';

/** @param {object} args @param {object} [overrides] */
function tx(args, overrides = {}) {
  return {
    transaction: {
      signer_id: GAME_CONTRACT,
      receiver_id: GAME_CONTRACT,
      actions: [
        {
          FunctionCall: {
            method_name: 'commit_batch',
            args: Buffer.from(JSON.stringify(args)).toString('base64'),
          },
        },
      ],
    },
    status: { SuccessValue: '' },
    ...overrides,
  };
}

describe('decodeCallArgs', () => {
  it('returns the JSON arguments of a successful call', () => {
    expect(decodeCallArgs(tx({ batch_id: 7 }), 'commit_batch')).toEqual({ batch_id: 7 });
  });

  it('refuses another method, a failed call and another signer', () => {
    expect(() => decodeCallArgs(tx({}), 'settle_batch')).toThrow('not a settle_batch call');
    expect(() =>
      decodeCallArgs(tx({}, { status: { Failure: { error: 'x' } } }), 'commit_batch')
    ).toThrow('failed');
    const other = tx({});
    other.transaction.signer_id = 'someone.testnet';
    expect(() => decodeCallArgs(other, 'commit_batch')).toThrow('not from the game contract');
  });
});

describe('isThisRace', () => {
  const race = { batchSlot: 7, drone1: { tokenId: 'd:1' }, drone2: { tokenId: 'd:2' } };
  const entry = /** @type {any} */ ({ batchId: 7, matchup: { a: 'd:1', b: 'd:2' } });

  it("accepts the commit of this batch with the page's two drones", () => {
    expect(isThisRace(race, entry)).toBe(true);
  });

  it('refuses another batch, another drone and swapped drones', () => {
    expect(isThisRace({ ...race, batchSlot: 8 }, entry)).toBe(false);
    expect(isThisRace({ ...race, drone2: { tokenId: 'd:9' } }, entry)).toBe(false);
    expect(
      isThisRace(race, /** @type {any} */ ({ batchId: 7, matchup: { a: 'd:2', b: 'd:1' } }))
    ).toBe(false);
  });
});

describe('pickRaceEntry', () => {
  const matchups = [{ a: 'd:1' }, { a: 'd:2' }, { a: 'd:3' }];
  const commit = { batch_id: 7, seed_hash: [1], matchups };
  const settle = { batch_id: 7, seed: [2], from: 1, results: [{ a: 'd:2' }, { a: 'd:3' }] };

  it('takes the matchup at the race index and the result at the index minus from', () => {
    expect(pickRaceEntry(commit, settle, 2)).toEqual({
      batchId: 7,
      seedHash: [1],
      seed: [2],
      matchup: { a: 'd:3' },
      result: { a: 'd:3' },
    });
  });

  it('refuses a race outside the chunk and transactions from different batches', () => {
    expect(() => pickRaceEntry(commit, settle, 0)).toThrow('not in these transactions');
    expect(() => pickRaceEntry({ ...commit, batch_id: 8 }, settle, 2)).toThrow('different batches');
  });
});
