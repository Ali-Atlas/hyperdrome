/**
 * Contract panic strings (SPEC.md 4.8) mapped to an HTTP status and the message a player sees.
 * The panic string is the contract's API for failure paths; the copy names the game rule in plain
 * words and never an internal term.
 */

/** @typedef {{ status: number, error: string }} MappedError */

/** @type {Readonly<Record<string, MappedError>>} */
export const CHAIN_ERRORS = Object.freeze({
  paused: { status: 503, error: 'The game is paused for maintenance. Try again shortly.' },
  'bad seq': { status: 409, error: 'Another action is still in progress. Try again.' },
  'not owner': { status: 403, error: 'You do not own this item.' },
  'not player': { status: 409, error: 'Your racing account is still being set up.' },
  locked: { status: 409, error: 'This drone is locked until its race finishes.' },
  'bound item': {
    status: 409,
    error: 'This item is bound to a drone. It can only move with that drone.',
  },
  listed: {
    status: 409,
    error: 'This item is listed on the marketplace. Cancel the listing first.',
  },
  'not listed': { status: 404, error: 'This listing is no longer active.' },
  'self buy': { status: 409, error: 'You cannot buy your own listing.' },
  'insufficient volts': { status: 402, error: 'Not enough Volts.' },
  'over cap': {
    status: 422,
    error: 'A stat is over its cap for this level: 10 + 4.5 x level, rounded down, at most 100.',
  },
  'cap exceeded': { status: 429, error: 'This account has reached its spending cap for today.' },
  'tsb exceeded': {
    status: 422,
    error: 'Total stats are over the budget for this level: 9 + 20 x level.',
  },
  'stat decrease': { status: 422, error: 'Stats can only go up.' },
  tier: { status: 422, error: 'This skin has no render for this drone tier yet.' },
  'bad slug': { status: 422, error: 'That account name is not allowed.' },
  exists: { status: 409, error: 'That account already exists.' },
  'state drift': { status: 409, error: 'The drone changed before its race settled.' },
  'bad reveal': { status: 409, error: 'This pack has already been opened.' },
  'too early': { status: 409, error: 'The pack is not ready to open yet. Try again in a moment.' },
  settled: { status: 409, error: 'This race has already settled.' },
  'bad seed': { status: 409, error: 'This race result could not be verified.' },
  'bad chunk': { status: 409, error: 'This race result does not match its matchup.' },
  'not found': { status: 404, error: 'That item does not exist.' },
  'same owner': { status: 409, error: 'Both racers belong to the same player.' },
  'bad level': { status: 422, error: 'Levels run from 1 to 20.' },
  'bad stat': { status: 422, error: 'Every stat must be at least 1.' },
  'bad template': { status: 422, error: 'That item type does not exist.' },
  'no supply': { status: 409, error: 'That skin is sold out.' },
  'low price': { status: 422, error: 'The minimum price is 10 Volts.' },
  'bad tier': { status: 422, error: 'That pack tier does not exist.' },
  'not migrated': { status: 503, error: 'The game is being upgraded. Try again shortly.' },
  team: { status: 409, error: 'AI team accounts cannot link a wallet.' },
  'bad wallet': { status: 422, error: 'That account cannot be used as a linked wallet.' },
  linked: { status: 409, error: 'A wallet is already linked. Unlink it from that wallet first.' },
  'not linked': { status: 409, error: 'Link a wallet first.' },
  'bad deposit': { status: 422, error: 'This call takes no deposit.' },
  'nothing to withdraw': { status: 422, error: 'Pick at least one item or some Volts.' },
  'too many tokens': { status: 422, error: 'Too many items in one withdrawal. Withdraw fewer.' },
  'not registered': {
    status: 409,
    error: 'Your wallet removed its Volts registration. Register it again to receive Volts.',
  },
});

/** Answer for a panic string this table does not know (a newer contract). */
const UNKNOWN_PANIC = Object.freeze({ status: 422, error: 'The game rejected this action.' });

/**
 * The HTTP status and player-facing message for a contract panic string.
 * @param {string} panic
 * @returns {MappedError}
 */
export function mapChainError(panic) {
  return Object.hasOwn(CHAIN_ERRORS, panic) ? CHAIN_ERRORS[panic] : UNKNOWN_PANIC;
}
