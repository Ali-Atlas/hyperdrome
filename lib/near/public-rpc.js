/**
 * Reads a transaction from public NEAR RPC nodes, for the browser's race verification (SPEC.md 11).
 * Plain `fetch` and no near-api-js, so it bundles for the client. Every URL allows browser CORS.
 */
import { ARCHIVAL_RPC_URL, DEFAULT_RPC_FAILOVER_URL, DEFAULT_RPC_URL } from './rpc-urls.js';

/** The game contract: it signs and receives every `commit_batch` and `settle_batch`. */
export const GAME_CONTRACT = 'game.hyperdrome.testnet';

const PUBLIC_RPC_URLS = [DEFAULT_RPC_URL, DEFAULT_RPC_FAILOVER_URL, ARCHIVAL_RPC_URL];

/** How long one RPC node may take to answer. */
const RPC_TIMEOUT_MS = 8_000;

/**
 * The finished transaction, from the first node that knows it.
 * @param {string} hash
 * @param {string} senderId the transaction's signer
 * @param {{ urls?: string[], fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<any>} the RPC's `tx` result
 */
export async function fetchPublicTx(
  hash,
  senderId,
  { urls = PUBLIC_RPC_URLS, fetchImpl = fetch } = {}
) {
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'verify',
          method: 'tx',
          params: { tx_hash: hash, sender_account_id: senderId, wait_until: 'EXECUTED' },
        }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      const body = await res.json();
      if (body.result) return body.result;
    } catch {
      // This node timed out or refused; the next one may answer.
    }
  }
  throw new Error(`No public RPC returned transaction ${hash}`);
}
