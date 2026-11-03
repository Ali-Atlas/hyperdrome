/**
 * RPC provider (SPEC.md 6): a `FailoverRpcProvider` over the primary and failover URLs (by default
 * dRPC's public testnet endpoint, then FastNear, both keyless). `NEAR_RPC_API_KEY`, when set, is
 * sent as `Authorization: Bearer` (docs.fastnear.com/auth) to whichever URL is FastNear.
 * near-api-js 7.4.0 has no request timeout, so each JSON-RPC call is raced against `timeoutMs`; a
 * timed-out call counts as a failure and the next provider takes it.
 */

import { FailoverRpcProvider, JsonRpcProvider } from 'near-api-js';
import { RpcTimeoutError } from './errors.js';

export const RPC_TIMEOUT_MS = 10_000;

/**
 * Retries inside one provider before failing over. near-api-js retries HTTP 500/503/408 and fetch
 * failures only; keep it short so the per-call timeout, not the retry loop, bounds latency.
 */
const RETRY_OPTIONS = { retries: 2, wait: 250, backoff: 1.5 };

/** `JsonRpcProvider` whose every JSON-RPC call fails with `RpcTimeoutError` after `timeoutMs`. */
export class TimedJsonRpcProvider extends JsonRpcProvider {
  /**
   * @param {{ url: string, headers?: Record<string, string> }} connection
   * @param {number} timeoutMs
   */
  constructor(connection, timeoutMs) {
    super(connection, RETRY_OPTIONS);
    this.timeoutMs = timeoutMs;
  }

  /**
   * @param {string} method
   * @param {unknown} params
   * @returns {Promise<any>}
   */
  sendJsonRpc(method, params) {
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RpcTimeoutError(method, this.timeoutMs)), this.timeoutMs);
    });
    const call = /** @type {(m: string, p: unknown) => Promise<unknown>} */ (
      super.sendJsonRpc
    ).call(this, method, params);
    return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  }
}

/**
 * The failover provider for the adapter.
 * @param {{ rpcUrl: string, rpcApiKey?: string, rpcFailoverUrl: string, timeoutMs?: number }} options
 * @returns {FailoverRpcProvider}
 */
export function createProvider({ rpcUrl, rpcApiKey, rpcFailoverUrl, timeoutMs = RPC_TIMEOUT_MS }) {
  return new FailoverRpcProvider(
    [rpcUrl, rpcFailoverUrl].map(
      (url) => new TimedJsonRpcProvider({ url, headers: authHeaders(url, rpcApiKey) }, timeoutMs)
    )
  );
}

/**
 * The FastNear Bearer header for a FastNear URL when a key is set; nothing otherwise.
 * @param {string} url
 * @param {string | undefined} apiKey
 * @returns {Record<string, string> | undefined}
 */
export function authHeaders(url, apiKey) {
  if (!apiKey) return undefined;
  const host = new URL(url).hostname;
  return host === 'fastnear.com' || host.endsWith('.fastnear.com')
    ? { Authorization: `Bearer ${apiKey}` }
    : undefined;
}
