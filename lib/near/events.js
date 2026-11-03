/**
 * NEP-297 event parsing (SPEC.md 4.7). Events are the `EVENT_JSON:` logs of a transaction's
 * outcomes, in the order the RPC returns them: the transaction outcome, then each receipt outcome.
 */

const PREFIX = 'EVENT_JSON:';

/**
 * @typedef {object} NearEvent
 * @property {string} standard e.g. `hyperdrome`, `nep171`, `nep141`
 * @property {string} version
 * @property {string} event e.g. `item_bound`
 * @property {unknown} data
 * @property {string} receiptId id of the outcome that logged it
 */

/**
 * The subset of an RPC final execution outcome this module reads.
 * @typedef {object} OutcomeLike
 * @property {{ id: string, outcome: { logs: string[] } }} [transaction_outcome]
 * @property {{ id: string, outcome: { logs: string[] } }[]} [receipts_outcome]
 */

/**
 * Parses one log line; returns null when it is not an event.
 * @param {string} log
 * @param {string} receiptId
 * @returns {NearEvent | null}
 */
export function parseEventLog(log, receiptId) {
  if (!log.startsWith(PREFIX)) return null;
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(log.slice(PREFIX.length));
  } catch (err) {
    console.error({
      scope: 'near',
      msg: 'malformed EVENT_JSON log',
      receiptId,
      error: String(err),
    });
    throw new Error(`malformed EVENT_JSON log in receipt ${receiptId}`);
  }
  const e = /** @type {Record<string, unknown>} */ (parsed);
  if (
    typeof e?.standard !== 'string' ||
    typeof e.version !== 'string' ||
    typeof e.event !== 'string'
  ) {
    throw new Error(`EVENT_JSON log without standard, version and event in receipt ${receiptId}`);
  }
  return { standard: e.standard, version: e.version, event: e.event, data: e.data, receiptId };
}

/**
 * Every event in the outcome, transaction outcome first, then receipts in RPC order.
 * @param {OutcomeLike} outcome
 * @returns {NearEvent[]}
 */
export function parseEvents(outcome) {
  const outcomes = [
    ...(outcome.transaction_outcome ? [outcome.transaction_outcome] : []),
    ...(outcome.receipts_outcome ?? []),
  ];
  /** @type {NearEvent[]} */
  const events = [];
  for (const o of outcomes) {
    for (const log of o.outcome.logs) {
      const event = parseEventLog(log, o.id);
      if (event) events.push(event);
    }
  }
  return events;
}
