/**
 * The play key (SPEC.md 4.1): a function-call access key scoped to the game contract and the
 * player methods, with a gas allowance. `playKeyRotation` builds the one transaction that replaces
 * it (SPEC.md 6 `rotatePlayKey`).
 */

import { PublicKey, actions } from 'near-api-js';

/** Play key scope (SPEC.md 4.1). */
export const PLAY_KEY_METHODS = [
  'allocate_stats',
  'equip',
  'bind',
  'list',
  'buy',
  'cancel',
  'open_pack',
  'reveal_pack',
  'vendor_buy_drone',
];

/** Default gas allowance of a play key: 1 NEAR, in yoctoNEAR. */
export const PLAY_KEY_ALLOWANCE = 1_000_000_000_000_000_000_000_000n;

/**
 * The actions of a play key rotation: DeleteKey for every function-call key scoped to the game
 * contract, then AddKey for the new play key with `allowance`.
 * @param {Awaited<ReturnType<import('near-api-js').Provider['viewAccessKeyList']>>['keys']} keys the account's access keys
 * @param {string} nextPublicKey the new play key (`ed25519:...`)
 * @param {string} gameId the game contract account
 * @param {bigint} allowance the new key's gas allowance in yoctoNEAR
 * @returns {import('near-api-js').Action[]}
 */
export function playKeyRotation(keys, nextPublicKey, gameId, allowance) {
  const oldPlayKeys = keys
    .filter(({ access_key: { permission } }) => {
      const fc =
        typeof permission === 'object' && 'FunctionCall' in permission
          ? permission.FunctionCall
          : null;
      return fc?.receiver_id === gameId;
    })
    .map((k) => PublicKey.fromString(String(k.public_key)));
  return [
    ...oldPlayKeys.map((pk) => actions.deleteKey(pk)),
    actions.addFunctionCallAccessKey(
      PublicKey.fromString(nextPublicKey),
      gameId,
      PLAY_KEY_METHODS,
      allowance
    ),
  ];
}
