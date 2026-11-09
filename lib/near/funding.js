/**
 * What pays for the chain work (SPEC.md 6): the settlement and ops keys' remaining allowances and
 * the game account's balance. Read-only.
 */

/** NEAR's storage price in yoctoNEAR per byte (`storage_amount_per_byte`, the protocol config). */
export const STORAGE_PRICE_PER_BYTE = 10_000_000_000_000_000_000n;

/**
 * @typedef {object} FundingStatus
 * @property {bigint | null} settlementAllowance yoctoNEAR left on the settlement key; null when unlimited
 * @property {bigint | null} opsAllowance yoctoNEAR left on the ops key; null when unlimited
 * @property {bigint} gameBalance the game account's balance in yoctoNEAR
 * @property {bigint} gameAvailable the balance above the account's storage stake, in yoctoNEAR
 */

/**
 * @param {import('near-api-js').Provider} provider
 * @param {string} accountId
 * @param {import('near-api-js').KeyPairSigner} signer
 * @returns {Promise<bigint | null>}
 */
async function remainingAllowance(provider, accountId, signer) {
  const publicKey = (await signer.getPublicKey()).toString();
  const { permission } = await provider.viewAccessKey({
    accountId,
    publicKey,
    finalityQuery: { finality: 'optimistic' },
  });
  if (typeof permission !== 'object' || !('FunctionCall' in permission)) return null;
  const { allowance } = permission.FunctionCall;
  return allowance === null || allowance === undefined ? null : BigInt(allowance);
}

/**
 * @param {import('near-api-js').Provider} provider
 * @param {{ gameId: string, ownerId: string, settlement: import('near-api-js').KeyPairSigner, ops: import('near-api-js').KeyPairSigner }} accounts
 * @returns {Promise<FundingStatus>}
 */
export async function readFunding(provider, { gameId, ownerId, settlement, ops }) {
  const [settlementAllowance, opsAllowance, game] = await Promise.all([
    remainingAllowance(provider, gameId, settlement),
    remainingAllowance(provider, ownerId, ops),
    provider.viewAccount({ accountId: gameId, blockQuery: { finality: 'optimistic' } }),
  ]);
  const gameBalance = BigInt(game.amount);
  return {
    settlementAllowance,
    opsAllowance,
    gameBalance,
    gameAvailable: gameBalance - BigInt(game.storage_usage) * STORAGE_PRICE_PER_BYTE,
  };
}
