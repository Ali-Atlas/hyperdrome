/**
 * NearBlocks explorer links (SPEC.md 6 and 15): `<base>/txns/<hash>`, `<base>/address/<id>` and
 * `<base>/nft-token/<contract>/<token>`.
 */

/** The explorer origin in the browser (`NEXT_PUBLIC_EXPLORER_URL`, SPEC.md 15). */
export const PUBLIC_EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://testnet.nearblocks.io';

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

/**
 * @param {string} base explorer origin
 * @param {string} contractId the NFT contract
 * @param {string} tokenId
 * @returns {string}
 */
export function explorerNftUrl(base, contractId, tokenId) {
  return `${base.replace(/\/+$/, '')}/nft-token/${encodeURIComponent(contractId)}/${encodeURIComponent(tokenId)}`;
}
