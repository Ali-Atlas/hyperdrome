/**
 * The wallet page's requests (SPEC.md 8, 11) that are not action-path mutations.
 */
import { PENDING_RETRY_MS } from '@/lib/client/chain-action';

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST JSON and read the body.
 * @param {string} url
 * @param {Record<string, unknown>} body
 */
export async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  /** @type {Record<string, any>} */
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: parsed };
}

/**
 * Link after signing: the route answers 202 while the outcome is unknown; the same request again
 * reads the chain first.
 * @param {{ accountId: string, publicKey: string, signature: string, nonce: string }} body
 */
export async function postLink(body) {
  for (;;) {
    const res = await post('/api/wallet/link', body);
    if (res.status !== 202) return res;
    await wait(PENDING_RETRY_MS);
  }
}

/**
 * Re-read the player's assets from chain and publish the new balance to NavShell.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function syncAssets() {
  const res = await post('/api/wallet/sync', {});
  if (!res.ok) return { ok: false, error: res.body.error };
  if (typeof res.body.volts === 'number') {
    window.dispatchEvent(new CustomEvent('volts:update', { detail: { balance: res.body.volts } }));
  }
  return { ok: true };
}

/**
 * A wallet or connector failure as toast copy.
 * @param {unknown} err
 * @param {string} fallback
 */
export function walletMessage(err, fallback) {
  const message = err instanceof Error ? err.message : '';
  if (/rejected|cancel/i.test(message)) return 'Cancelled in your wallet.';
  return message || fallback;
}
