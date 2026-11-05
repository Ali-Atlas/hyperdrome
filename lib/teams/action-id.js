/**
 * Action ids of the AI teams (SPEC.md 10): a name-based uuid (version 5, RFC 9562) of
 * `<team>:<slot>:<step>:<subject>`, so the same decision in the same tick always carries the same
 * id and the action path replays it instead of sending it twice.
 */
import { createHash } from 'node:crypto';

/** The RFC 9562 DNS namespace. */
const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * A version 5 uuid: SHA-1 of the namespace bytes and the name.
 * @param {string} namespace a uuid
 * @param {string} name
 * @returns {string}
 */
export function uuidV5(namespace, name) {
  const b = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Namespace of every team action id. */
export const TEAM_ACTION_NAMESPACE = uuidV5(NAMESPACE_DNS, 'teams.hyperdrome');

/**
 * The action id of a team's step in a tick.
 * @param {string} team the team slug
 * @param {number} slot the tick's batch slot
 * @param {string} step `equip`, `bind`, `allocate`, `capsule`, `list` or `buy`
 * @param {string} subject what the step acts on (a token id, or the capsule tier)
 * @returns {string}
 */
export function teamActionId(team, slot, step, subject) {
  return uuidV5(TEAM_ACTION_NAMESPACE, `${team}:${slot}:${step}:${subject}`);
}
