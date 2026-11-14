/**
 * NEAR cost estimate of the showcase seed, from the figures measured on testnet (SPEC.md 15,
 * sign-up cost). Pure. Storage per token and the gas of `list` were not measured; they are marked
 * as estimates and rounded up.
 */
import { OPERATOR_KIT, PILOTS, kitSteps, pilotKit } from './plan.js';

/** A sign-up (15): what the game account pays, and the ops key's gas. */
const SIGNUP_GAME_NEAR = 0.0677;
const SIGNUP_OPS_NEAR = 0.0104;
/** Ops-key gas (15): 0.0104 NEAR bought the sign-up's 42.5 TGas. */
const OPS_NEAR_PER_TGAS = SIGNUP_OPS_NEAR / 42.5;
/** Measured gas per mint (15), in TGas. */
const MINT_TGAS = Object.freeze({ mint_drone: 8.1, mint_item: 9.0, mint_volts: 2.6 });
/** A player's `bind` (15): 3.5 TGas, 0.00033 NEAR from its own account. */
const BIND_NEAR = 0.00033;
/** Estimate: a `list` at 5 TGas at the same gas price. */
const LIST_NEAR = 0.0005;
/** Estimate: bytes of contract storage per minted token and per listing; 10^19 yocto per byte. */
const TOKEN_BYTES = 450;
const LISTING_BYTES = 200;
const NEAR_PER_BYTE = 1e-5;

/**
 * @returns {{ transactions: number, mints: number, binds: number, lists: number, opsNear: number, gameNear: number, playerNear: number }}
 *   `opsNear` from the ops key's allowance on the owner account, `gameNear` from the game account,
 *   `playerNear` the most any one account spends from its own 0.05 NEAR
 */
export function estimateCost() {
  const kits = [OPERATOR_KIT, ...PILOTS.map(pilotKit)].map(kitSteps);
  const steps = kits.flat();
  const count = (/** @type {string} */ method) => steps.filter((s) => s.method === method).length;
  const tokens = count('mint_drone') + count('mint_item');
  const mintTgas =
    count('mint_drone') * MINT_TGAS.mint_drone +
    count('mint_item') * MINT_TGAS.mint_item +
    count('mint_volts') * MINT_TGAS.mint_volts;
  const perPlayer = kits.map(
    (kit) =>
      kit.filter((s) => s.method === 'bind').length * BIND_NEAR +
      kit.filter((s) => s.method === 'list').length * LIST_NEAR
  );
  return {
    // A sign-up is 5 ops transactions and 2 binds (12).
    transactions: steps.length + PILOTS.length * 7,
    mints: tokens + count('mint_volts'),
    binds: count('bind'),
    lists: count('list'),
    opsNear: PILOTS.length * SIGNUP_OPS_NEAR + mintTgas * OPS_NEAR_PER_TGAS,
    gameNear:
      PILOTS.length * SIGNUP_GAME_NEAR +
      (tokens * TOKEN_BYTES + count('list') * LISTING_BYTES) * NEAR_PER_BYTE,
    playerNear: Math.max(...perPlayer) + 2 * BIND_NEAR,
  };
}
