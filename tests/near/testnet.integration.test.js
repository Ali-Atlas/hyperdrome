/**
 * Testnet integration run for the chain adapter (BUILD_PLAN.md T7). Gated by
 * NEAR_TESTNET_INTEGRATION=1; skipped in CI. Reads the ops and settlement keys from
 * ~/.near-credentials/testnet (never from the repo) and uses fresh random encryption keys per run.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRealNear } from '../../lib/near/adapter.js';
import { DEFAULT_RPC_FAILOVER_URL, DEFAULT_RPC_URL } from '../../lib/near/config.js';
import { ContractPanicError } from '../../lib/near/errors.js';

const enabled = process.env.NEAR_TESTNET_INTEGRATION === '1';
const GAME = 'game.hyperdrome.testnet';
const OWNER = 'hyperdrome.testnet';
/** A well-formed transaction hash that is not on testnet. */
const UNSEEN_HASH = '7jZ2bEAFfTEiQkCsAaSVQoJCyLQkTn1bCnB6C8AbGYUq';

/** @param {string} name */
const credential = (name) =>
  JSON.parse(readFileSync(join(homedir(), '.near-credentials', 'testnet', name), 'utf8'))
    .private_key;

/** @param {string} line */
const report = (line) => void process.stdout.write(`[t7-integration] ${line}\n`);

/** @param {Partial<import('../../lib/near/config.js').NearConfig>} [overrides] */
function adapter(overrides = {}) {
  return createRealNear({
    network: 'testnet',
    rpcUrl: DEFAULT_RPC_URL,
    rpcFailoverUrl: DEFAULT_RPC_FAILOVER_URL,
    ownerId: OWNER,
    gameId: GAME,
    opsKey: credential('hyperdrome.testnet-ops.json'),
    settlementKey: credential('hyperdrome.testnet-settlement.json'),
    keyEncryptionKey: randomBytes(32).toString('hex'),
    adminKeyEncryptionKey: randomBytes(32).toString('hex'),
    explorerUrl: 'https://testnet.nearblocks.io',
    ...overrides,
  });
}

/**
 * Access keys of an account over plain JSON-RPC.
 * @param {string} accountId
 * @returns {Promise<Array<{ public_key: string, access_key: { permission: any } }>>}
 */
async function accessKeys(accountId) {
  const res = await fetch(DEFAULT_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: { request_type: 'view_access_key_list', finality: 'final', account_id: accountId },
    }),
  });
  return (await res.json()).result.keys;
}

/** How long a read may take to show a write: the adapter answers at `EXECUTED`, before `final`. */
const READ_AFTER_WRITE_TIMEOUT_MS = 15_000;

/**
 * Re-reads until `ready` accepts the value, for an on-chain read that follows a write. At the time
 * limit it returns the last value, so the assertion names what is wrong, or rethrows the last error.
 * @template T
 * @param {() => Promise<T>} read
 * @param {(value: T) => boolean} ready
 * @returns {Promise<T>}
 */
async function afterWrite(read, ready) {
  const deadline = Date.now() + READ_AFTER_WRITE_TIMEOUT_MS;
  for (;;) {
    /** @type {any} */
    let value;
    /** @type {unknown} */
    let failure = null;
    try {
      value = await read();
      if (ready(value)) return value;
    } catch (err) {
      failure = err;
    }
    if (Date.now() >= deadline) {
      if (failure) throw failure;
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

describe.skipIf(!enabled)('chain adapter on testnet', () => {
  it(
    'creates a player, binds an item, maps a panic, rotates the play key and fails over',
    { timeout: 240_000 },
    async () => {
      const near = adapter();
      const slug = `t7${randomBytes(3).toString('hex')}`;

      const created = await near.createPlayerAccount({ slug, isTeam: false });
      const { accountId } = created;
      report(`create_player ${accountId} ${near.explorerTx(created.txHash)}`);
      expect(accountId).toBe(`p-${slug}.${GAME}`);
      expect(
        await afterWrite(
          () => near.view('get_player', { account: accountId }),
          (player) => player !== null
        )
      ).toMatchObject({
        seq: 0,
        is_team: false,
      });

      // The bootstrap resolves an unknown create_player by hash under the owner (SPEC.md 12).
      const resolved = await afterWrite(
        () => near.resolveOutcome(accountId, 0, created.txHash, { senderId: OWNER }),
        (outcome) => outcome.applied
      );
      report(
        `resolveOutcome(create_player) applied=${resolved.applied} result=${JSON.stringify(resolved.applied && resolved.result)}`
      );
      expect(resolved).toMatchObject({ applied: true, result: true, txHash: created.txHash });

      const keys = await afterWrite(
        () => accessKeys(accountId),
        (list) => list.length === 2
      );
      report(`keys: ${JSON.stringify(keys.map((k) => [k.public_key, k.access_key.permission]))}`);
      expect(keys).toHaveLength(2);
      expect(keys.filter((k) => k.access_key.permission === 'FullAccess')).toHaveLength(1);
      const fc = keys.find((k) => typeof k.access_key.permission === 'object')?.access_key
        .permission.FunctionCall;
      expect(fc.receiver_id).toBe(GAME);
      expect([...fc.method_names].sort()).toEqual([
        'allocate_stats',
        'bind',
        'buy',
        'cancel',
        'equip',
        'list',
        'open_pack',
        'reveal_pack',
        'vendor_buy_drone',
      ]);

      const drone = await near.callAsOps('mint_drone', {
        owner: accountId,
        name: `T7 ${slug}`,
        level: 1,
        stats: [1, 1, 1, 1, 1, 1, 1, 1, 1],
        active_hint: true,
      });
      const mod = await near.callAsOps('mint_item', {
        owner: accountId,
        kind: 'mod',
        template: 1,
        placeholder_name: null,
      });
      report(`mint_drone ${drone.result} ${near.explorerTx(drone.txHash)}`);
      report(`mint_item ${mod.result} ${near.explorerTx(mod.txHash)}`);

      /** @type {string[]} */
      const signed = [];
      const bind = await near.callAsPlayer(
        accountId,
        created.playKeyEnc,
        'bind',
        { drone: drone.result, item: mod.result },
        {
          seq: 1,
          onSigned: async (hash) => {
            signed.push(hash);
          },
        }
      );
      expect(signed).toEqual([bind.txHash]);
      report(
        `bind ${near.explorerTx(bind.txHash)} events=${JSON.stringify(bind.events.map((e) => e.event))}`
      );
      expect(bind.events.find((e) => e.event === 'item_bound')?.data).toEqual({
        drone: drone.result,
        item: mod.result,
      });
      expect(
        await afterWrite(
          () => near.nextSeq(accountId),
          (seq) => seq === 2
        )
      ).toBe(2);
      // A finished transaction's events read back by hash; a hash the chain never saw is null.
      const readBack = await afterWrite(
        () => near.transactionEvents(bind.txHash, { senderId: accountId }),
        (events) => events !== null
      );
      report(`transactionEvents(bind) events=${JSON.stringify(readBack?.map((e) => e.event))}`);
      expect(readBack).toEqual(bind.events);
      expect(await near.transactionEvents(UNSEEN_HASH)).toBeNull();

      const again = await near
        .callAsPlayer(accountId, created.playKeyEnc, 'bind', {
          drone: drone.result,
          item: mod.result,
        })
        .catch((e) => e);
      report(
        `second bind -> ${again?.name}: ${again?.panic} ${again?.txHash ? near.explorerTx(again.txHash) : ''}`
      );
      expect(again).toBeInstanceOf(ContractPanicError);
      expect(again.panic).toBe('bound item');

      const oldPlay = fc
        ? keys.find((k) => typeof k.access_key.permission === 'object')?.public_key
        : null;
      // The allowance an AI team's play key gets (SPEC.md 2.10); the default stays 1 NEAR.
      const allowance = 2n * 10n ** 24n;
      const rotated = await near.rotatePlayKey(accountId, created.adminKeyEnc, {
        keyVersion: created.keyVersion,
        allowance,
      });
      report(`rotatePlayKey keyVersion=${rotated.keyVersion} ${near.explorerTx(rotated.txHash)}`);
      expect(rotated.keyVersion).toBe(2);
      const after = await afterWrite(
        () => accessKeys(accountId),
        (list) =>
          !list.some((k) => k.public_key === oldPlay) &&
          list.some((k) => typeof k.access_key.permission === 'object')
      );
      report(`keys after rotation: ${JSON.stringify(after.map((k) => k.public_key))}`);
      expect(after).toHaveLength(2);
      expect(after.map((k) => k.public_key)).not.toContain(oldPlay);
      const newPlay = after.find((k) => typeof k.access_key.permission === 'object');
      expect(newPlay?.access_key.permission.FunctionCall.allowance).toBe(String(allowance));
      const balance = await afterWrite(
        () => near.accountBalance(accountId),
        (yocto) => yocto > 0n
      );
      report(`accountBalance ${balance} yoctoNEAR`);
      expect(balance).toBeGreaterThan(0n);
      expect(balance).toBeLessThan(10n ** 23n);
      expect(
        await afterWrite(
          () => near.view('get_player', { account: accountId }),
          (player) => player?.seq === 1
        )
      ).toMatchObject({ seq: 1 });

      report(`account ${near.explorerAccount(accountId)}`);
    }
  );
});
