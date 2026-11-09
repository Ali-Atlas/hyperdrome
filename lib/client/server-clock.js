/**
 * The server's clock as the browser sees it (SPEC.md 11): the difference between a response's
 * `Date` header and the local clock when it arrived. A swap must not be offered once either clock
 * says the strategy window has closed.
 */

/** The `Date` header has 1 s resolution and is older than its arrival by the network delay. */
const DATE_HEADER_MARGIN_MS = 1500;

/**
 * The contract locks from the commit's block time; `lockAt` is built from when the server stored
 * the commit, 2.05 to 2.37 s later over five production batches (SPEC.md 11).
 */
const CHAIN_LOCK_LEAD_MS = 3000;

/** Server time minus local time, once a response has been seen. @type {number | null} */
let offsetMs = null;

/**
 * Record a response's `Date` header.
 * @param {string | null} header
 */
export function noteServerDate(header) {
  const serverMs = header ? Date.parse(header) : Number.NaN;
  if (!Number.isNaN(serverMs)) offsetMs = serverMs - Date.now();
}

/**
 * The local-clock instant at which the strategy window has closed: `lockAt` by the local clock or
 * the server's, less the time the contract's lock runs ahead of it.
 * @param {string} lockAt ISO time
 * @returns {number} ms on the local clock
 */
export function lockInstantMs(lockAt) {
  const lockMs = Date.parse(lockAt);
  const byServer = offsetMs === null ? lockMs : lockMs - offsetMs - DATE_HEADER_MARGIN_MS;
  return Math.min(lockMs, byServer) - CHAIN_LOCK_LEAD_MS;
}
