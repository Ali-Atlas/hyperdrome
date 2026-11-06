/**
 * Client side of the action path (SPEC.md 8). One `actionId` (`crypto.randomUUID()`) is made per
 * click and sent with every request for that click: a 202 `{ pending }` answer is sent again,
 * unchanged, every PENDING_RETRY_MS until the server answers 200 or an error. A click whose
 * outcome never reached the browser (a network failure, a gateway page instead of JSON) keeps its
 * actionId, so the next identical request replays it instead of starting a second action. Any
 * JSON answer with a 200 status or an `error` string settles the click, except a 409: that is a
 * lease conflict or a rule the replay answers identically, so the click keeps its actionId and the
 * same id is sent again on the next identical request.
 */

/** Wait between replays of a pending action (SPEC.md 12 uses the same cadence). */
export const PENDING_RETRY_MS = 3000;

/** Shown while a 202 answer is replayed. */
export const PENDING_MESSAGE = 'Confirming on-chain';

/**
 * @typedef {{ status: number, ok: boolean, body: Record<string, any>, actionId: string }} ActionResult
 * @typedef {{
 *   onPending?: () => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   fetchImpl?: typeof fetch,
 * }} ActionOptions
 */

/** Action ids of clicks whose outcome is unknown, keyed by url and body. */
const unsettled = new Map();

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST `body` plus an actionId to `url` and follow the action to a settled answer.
 * @param {string} url the mutation route
 * @param {Record<string, unknown>} body the route's body without `actionId`
 * @param {ActionOptions} [options]
 * @returns {Promise<ActionResult>} the settled answer; `ok` is true only for a 200
 */
export async function postChainAction(url, body, options = {}) {
  const key = `${url} ${JSON.stringify(body)}`;
  const actionId = unsettled.get(key) ?? crypto.randomUUID();
  unsettled.set(key, actionId);
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? wait;
  const payload = JSON.stringify({ actionId, ...body });
  for (;;) {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    /** @type {Record<string, any>} */
    const parsed = await res.json().catch(() => ({}));
    if (res.status === 202 && parsed.pending) {
      options.onPending?.();
      await sleep(PENDING_RETRY_MS);
      continue;
    }
    const settled = res.status === 200 || (res.status !== 409 && typeof parsed.error === 'string');
    if (settled) unsettled.delete(key);
    return { status: res.status, ok: res.status === 200, body: parsed, actionId };
  }
}

/**
 * The message a page shows for a settled answer that is not a 200: the body's player copy
 * (chain-errors, the route guards) or `fallback`.
 * @param {ActionResult} result
 * @param {string} fallback
 * @returns {string}
 */
export function actionError(result, fallback) {
  return typeof result.body.error === 'string' ? result.body.error : fallback;
}
