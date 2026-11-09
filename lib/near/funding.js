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
 * @property {bigint | null} lowestTeamBalance the smallest AI team balance in yoctoNEAR; null with no teams given
 * @property {bigint | null} lowestTeamAllowance the smallest team play-key allowance in yoctoNEAR; 0 for a team with no play key, null with no teams given or when all are unlimited
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
 * One team's balance and the allowance of its play key: the function-call key scoped to the game
 * contract, which `rotatePlayKey` keeps to one per account.
 * @param {import('near-api-js').Provider} provider
 * @param {string} accountId
 * @param {string} gameId
 * @returns {Promise<{ balance: bigint, allowance: bigint | null }>}
 */
async function teamFunds(provider, accountId, gameId) {
  const finality = { finality: /** @type {const} */ ('optimistic') };
  const [account, { keys }] = await Promise.all([
    provider.viewAccount({ accountId, blockQuery: finality }),
    provider.viewAccessKeyList({ accountId, finalityQuery: finality }),
  ]);
  const play = keys
    .map(({ access_key: { permission } }) =>
      typeof permission === 'object' && 'FunctionCall' in permission
        ? permission.FunctionCall
        : null
    )
    .find((fc) => fc?.receiver_id === gameId);
  if (!play) return { balance: BigInt(account.amount), allowance: 0n };
  const { allowance } = play;
  return {
    balance: BigInt(account.amount),
    allowance: allowance === null || allowance === undefined ? null : BigInt(allowance),
  };
}

/**
 * The smallest of `values` ignoring nulls, or null when none is left.
 * @param {(bigint | null)[]} values
 * @returns {bigint | null}
 */
function lowest(values) {
  return values.reduce(
    (min, v) => (v !== null && (min === null || v < min) ? v : min),
    /** @type {bigint | null} */ (null)
  );
}

/**
 * @param {import('near-api-js').Provider} provider
 * @param {{ gameId: string, ownerId: string, settlement: import('near-api-js').KeyPairSigner, ops: import('near-api-js').KeyPairSigner, teamAccounts?: string[] }} accounts
 * @returns {Promise<FundingStatus>}
 */
export async function readFunding(
  provider,
  { gameId, ownerId, settlement, ops, teamAccounts = [] }
) {
  const [settlementAllowance, opsAllowance, game, teams] = await Promise.all([
    remainingAllowance(provider, gameId, settlement),
    remainingAllowance(provider, ownerId, ops),
    provider.viewAccount({ accountId: gameId, blockQuery: { finality: 'optimistic' } }),
    Promise.all(teamAccounts.map((id) => teamFunds(provider, id, gameId))),
  ]);
  const gameBalance = BigInt(game.amount);
  return {
    settlementAllowance,
    opsAllowance,
    gameBalance,
    gameAvailable: gameBalance - BigInt(game.storage_usage) * STORAGE_PRICE_PER_BYTE,
    lowestTeamBalance: lowest(teams.map((t) => t.balance)),
    lowestTeamAllowance: lowest(teams.map((t) => t.allowance)),
  };
}
