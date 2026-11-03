import { describe, expect, it, vi } from 'vitest';
import { callResultFromOutcome } from '../../lib/near/adapter.js';
import {
  ContractPanicError,
  TransactionFailedError,
  panicFromFailure,
  panicMessage,
} from '../../lib/near/errors.js';
import { parseEvents } from '../../lib/near/events.js';
import { outcome } from './fake-rpc.js';

const itemBound = {
  standard: 'hyperdrome',
  version: '1.0.0',
  event: 'item_bound',
  data: { drone: 'd:1', item: 'm:1' },
};
const equipped = {
  standard: 'hyperdrome',
  version: '1.0.0',
  event: 'equipped',
  data: { drone: 'd:1', kind: 'mod', item: 'm:1' },
};
const nftMint = {
  standard: 'nep171',
  version: '1.0.0',
  event: 'nft_mint',
  data: [{ owner_id: 'p-a.game.test', token_ids: ['m:2'] }],
};

const fixture = outcome({
  hash: 'TXHASH',
  status: { SuccessValue: Buffer.from('"d:1"').toString('base64') },
  receiptLogs: [
    [
      `EVENT_JSON:${JSON.stringify(itemBound)}`,
      'a plain log line',
      `EVENT_JSON:${JSON.stringify(equipped)}`,
    ],
    [`EVENT_JSON:${JSON.stringify(nftMint)}`],
  ],
});

/** @param {string} message */
const panicStatus = (message) => ({
  Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: message } } } },
});

describe('event parsing', () => {
  it('returns every EVENT_JSON log in receipt order, skipping other logs', () => {
    const events = parseEvents(fixture);
    expect(events.map((e) => e.event)).toEqual(['item_bound', 'equipped', 'nft_mint']);
    expect(events.map((e) => e.receiptId)).toEqual(['receipt1', 'receipt1', 'receipt2']);
    expect(events[0]).toMatchObject({
      standard: 'hyperdrome',
      version: '1.0.0',
      data: itemBound.data,
    });
  });

  it('throws on a malformed EVENT_JSON log instead of dropping it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      parseEvents(outcome({ hash: 'H', status: {}, receiptLogs: [['EVENT_JSON:{nope']] }))
    ).toThrow(/malformed/);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'near', receiptId: 'receipt1' })
    );
    spy.mockRestore();
  });
});

describe('outcome mapping', () => {
  it('returns the decoded return value, the hash and the events', () => {
    expect(callResultFromOutcome(fixture, 'TXHASH', 'bind')).toMatchObject({
      txHash: 'TXHASH',
      result: 'd:1',
    });
    expect(callResultFromOutcome(fixture, 'TXHASH', 'bind').events).toHaveLength(3);
  });

  it('maps a `bad seq` panic to ContractPanicError with the short SPEC 4.8 string', () => {
    const failed = outcome({ hash: 'H', status: panicStatus('Smart contract panicked: bad seq') });
    expect(() => callResultFromOutcome(failed, 'H', 'bind')).toThrow(ContractPanicError);
    try {
      callResultFromOutcome(failed, 'H', 'bind');
    } catch (err) {
      expect(err).toMatchObject({ panic: 'bad seq', method: 'bind', txHash: 'H' });
    }
  });

  it('reads the older HostError GuestPanic shape too', () => {
    const failure = {
      ActionError: {
        kind: { FunctionCallError: { HostError: { GuestPanic: { panic_msg: 'bound item' } } } },
      },
    };
    expect(panicFromFailure(failure)).toBe('bound item');
  });

  it('raises TransactionFailedError for non-panic failures', () => {
    const failed = outcome({
      hash: 'H',
      status: { Failure: { ActionError: { kind: { AccountDoesNotExist: { account_id: 'x' } } } } },
    });
    expect(() => callResultFromOutcome(failed, 'H', 'bind')).toThrow(TransactionFailedError);
  });

  it('extracts panic strings from execution error text', () => {
    expect(panicMessage('Smart contract panicked: not player')).toBe('not player');
    expect(panicMessage('{"ExecutionError":"Smart contract panicked: listed"}')).toBe('listed');
    expect(panicMessage('wasm trap')).toBeNull();
  });
});
