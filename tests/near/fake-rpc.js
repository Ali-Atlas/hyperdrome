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
 * A minimal Borsh reader over a signed transaction, positioned after the header (signer, public
 * key, nonce, receiver, block hash) at the action count.
 * @param {string} signedTxBase64
 */
function readTransaction(signedTxBase64) {
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
  /** An ed25519 public key (type byte 0, then 32 bytes) as hex. */
  const publicKey = () => {
    u8();
    const key = buf.subarray(at, at + 32).toString('hex');
    at += 32;
    return key;
  };

  const signerId = string();
  publicKey();
  const nonce = u64();
  const receiverId = string();
  at += 32; // block hash
  return { signerId, receiverId, nonce, u8, u32, u64, u128, bytes, string, publicKey };
}

/**
 * Decodes the function call of a base64 signed transaction (Borsh, Transaction V0).
 * @param {string} signedTxBase64
 * @returns {{ signerId: string, receiverId: string, nonce: bigint, methodName: string, args: any, gas: bigint, deposit: bigint }}
 */
export function decodeFunctionCall(signedTxBase64) {
  const { signerId, receiverId, nonce, ...r } = readTransaction(signedTxBase64);
  if (r.u32() !== 1 || r.u8() !== 2) throw new Error('expected exactly one FunctionCall action');
  const methodName = r.string();
  const args = JSON.parse(r.bytes().toString('utf8'));
  const gas = r.u64();
  const deposit = r.u128();
  return { signerId, receiverId, nonce, methodName, args, gas, deposit };
}

/**
 * Decodes a key rotation: DeleteKey actions (Borsh action 6) followed by one AddKey (action 5) of
 * a function-call key. Public keys are hex.
 * @param {string} signedTxBase64
 * @returns {{ signerId: string, receiverId: string, deleted: string[], added: { publicKey: string, allowance: bigint | null, receiverId: string, methodNames: string[] } }}
 */
export function decodeKeyRotation(signedTxBase64) {
  const { signerId, receiverId, ...r } = readTransaction(signedTxBase64);
  const count = r.u32();
  /** @type {string[]} */
  const deleted = [];
  for (let i = 0; i < count - 1; i += 1) {
    if (r.u8() !== 6) throw new Error('expected a DeleteKey action');
    deleted.push(r.publicKey());
  }
  if (r.u8() !== 5) throw new Error('expected an AddKey action last');
  const publicKey = r.publicKey();
  r.u64(); // access key nonce
  if (r.u8() !== 0) throw new Error('expected a function-call access key');
  const allowance = r.u8() === 1 ? r.u128() : null;
  const keyReceiver = r.string();
  const methodNames = Array.from({ length: r.u32() }, () => r.string());
  return {
    signerId,
    receiverId,
    deleted,
    added: { publicKey, allowance, receiverId: keyReceiver, methodNames },
  };
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
