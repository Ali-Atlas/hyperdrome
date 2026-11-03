/**
 * A fake NEAR JSON-RPC server for adapter tests. It answers the methods the adapter uses, records
 * every request, can hang (to simulate an outage) and decodes signed transactions with its own
 * minimal Borsh reader, so tests check what was actually sent without importing near-api-js.
 */

import { createServer } from 'node:http';

/** 32 zero bytes in base58. */
export const ZERO_HASH = '1'.repeat(32);

/**
 * @typedef {object} FakeRpcRequest
 * @property {string} method
 * @property {any} params
 */

/**
 * @typedef {(req: FakeRpcRequest) => { result?: unknown, error?: unknown } | 'hang' | undefined} FakeRpcHandler
 */

/**
 * Starts a fake RPC on a random local port.
 * @param {FakeRpcHandler} handler
 * @returns {Promise<{ url: string, requests: FakeRpcRequest[], close: () => Promise<void> }>}
 */
export async function startFakeRpc(handler) {
  /** @type {FakeRpcRequest[]} */
  const requests = [];
  /** @type {Set<import('node:http').ServerResponse>} */
  const hanging = new Set();
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body);
      requests.push({ method, params });
      const reply = handler({ method, params });
      if (reply === 'hang') {
        hanging.add(res);
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          ...(reply ?? { error: { message: `unhandled ${method}` } }),
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const res of hanging) res.destroy();
        server.close(() => resolve(undefined));
      }),
  };
}

/** Answers for the reads every transaction needs: access key nonce and the final block. */
export const chainBasics = {
  accessKey: () => ({
    result: { nonce: 5, permission: 'FullAccess', block_height: 100, block_hash: ZERO_HASH },
  }),
  block: () => ({ result: { header: { hash: ZERO_HASH, height: 100 } } }),
};

/**
 * A `call_function` query result carrying `value` as JSON.
 * @param {unknown} value
 * @returns {{ result: object }}
 */
export function viewResult(value) {
  return {
    result: {
      result: [...Buffer.from(JSON.stringify(value))],
      logs: [],
      block_height: 100,
      block_hash: ZERO_HASH,
    },
  };
}

/**
 * Decodes the function call of a base64 signed transaction (Borsh, Transaction V0).
 * @param {string} signedTxBase64
 * @returns {{ signerId: string, receiverId: string, nonce: bigint, methodName: string, args: any, gas: bigint, deposit: bigint }}
 */
export function decodeFunctionCall(signedTxBase64) {
  const buf = Buffer.from(signedTxBase64, 'base64');
  let at = 0;
  const u8 = () => buf[at++];
  const u32 = () => {
    const v = buf.readUInt32LE(at);
    at += 4;
    return v;
  };
  const u64 = () => {
    const v = buf.readBigUInt64LE(at);
    at += 8;
    return v;
  };
  const u128 = () => u64() + (u64() << 64n);
  const bytes = () => {
    const n = u32();
    const out = buf.subarray(at, at + n);
    at += n;
    return out;
  };
  const string = () => bytes().toString('utf8');

  const signerId = string();
  u8(); // public key type (0 = ed25519)
  at += 32; // public key
  const nonce = u64();
  const receiverId = string();
  at += 32; // block hash
  const actionCount = u32();
  if (actionCount !== 1 || u8() !== 2) throw new Error('expected exactly one FunctionCall action');
  const methodName = string();
  const args = JSON.parse(bytes().toString('utf8'));
  const gas = u64();
  const deposit = u128();
  return { signerId, receiverId, nonce, methodName, args, gas, deposit };
}

/**
 * A final execution outcome: `status`, plus receipts with the given logs.
 * @param {{ hash: string, status: object, receiptLogs?: string[][] }} spec
 * @returns {object}
 */
export function outcome({ hash, status, receiptLogs = [] }) {
  /** @param {string} id @param {string[]} logs @param {object} st */
  const exec = (id, logs, st) => ({
    id,
    block_hash: ZERO_HASH,
    proof: [],
    outcome: {
      logs,
      receipt_ids: [],
      gas_burnt: 1,
      tokens_burnt: '0',
      executor_id: 'game.test',
      status: st,
    },
  });
  return {
    final_execution_status: 'EXECUTED',
    status,
    transaction: { hash },
    transaction_outcome: exec(hash, [], { SuccessReceiptId: 'r0' }),
    receipts_outcome: receiptLogs.map((logs, i) =>
      exec(`receipt${i + 1}`, logs, { SuccessValue: '' })
    ),
  };
}
