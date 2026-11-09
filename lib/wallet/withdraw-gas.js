/**
 * Gas attached to `withdraw` (SPEC.md 13), for the ops path and the wallet-signed path. A
 * function-call key's allowance is charged the full attached gas, so it scales with the tokens the
 * call moves: twice the sandbox-measured line (`tests/wallet.rs` asserts the line), capped at the
 * 150 TGas budget. Pure, so the page and the server share it.
 */

const TGAS = 1_000_000_000_000n;
/** Measured line in hundredths of a TGas: 4 TGas plus 1.85 TGas per moved token. */
const BASE_CENTI_TGAS = 400n;
const PER_TOKEN_CENTI_TGAS = 185n;
const MARGIN = 2n;
const CAP_TGAS = 150n;

/**
 * @param {number} movedTokens requested tokens plus their cached bound items
 * @returns {bigint} gas units
 */
export function withdrawGas(movedTokens) {
  const line = BASE_CENTI_TGAS + PER_TOKEN_CENTI_TGAS * BigInt(movedTokens);
  const attached = (line * MARGIN * TGAS) / 100n;
  const cap = CAP_TGAS * TGAS;
  return attached < cap ? attached : cap;
}
