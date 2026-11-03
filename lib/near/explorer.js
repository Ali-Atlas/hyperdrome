/**
 * NearBlocks explorer links (SPEC.md 6 and 15): `<base>/txns/<hash>` and `<base>/address/<id>`.
 */

/**
 * @param {string} base explorer origin, e.g. `https://testnet.nearblocks.io`
 * @param {string} hash transaction hash
 * @returns {string}
 */
export function explorerTxUrl(base, hash) {
  return `${base.replace(/\/+$/, '')}/txns/${encodeURIComponent(hash)}`;
}

/**
 * @param {string} base explorer origin
 * @param {string} accountId
 * @returns {string}
 */
export function explorerAccountUrl(base, accountId) {
  return `${base.replace(/\/+$/, '')}/address/${encodeURIComponent(accountId)}`;
}
