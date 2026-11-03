/**
 * Drone state hash (SPEC.md 4.4 `settle_batch`, 5): sha256 of the 9 stat bytes, then the equipped
 * mod template id and skin template id as u16 little-endian (0 = none). Mirrors the contract's
 * `stats_hash` view, so the server and the contract agree on the state a race was run with.
 */

import { sha256, toHex } from './sha256.js';

/**
 * @param {ArrayLike<number>} stats9 the 9 stats in contract order, each 0-255
 * @param {number} modTemplateId 0-65535, 0 for none
 * @param {number} skinTemplateId 0-65535, 0 for none
 * @returns {string} lowercase hex of the 32-byte digest
 */
export function statsHash(stats9, modTemplateId, skinTemplateId) {
  if (stats9.length !== 9) throw new Error('statsHash needs 9 stats');
  const bytes = new Uint8Array(13);
  for (let i = 0; i < 9; i++) {
    const s = stats9[i];
    if (!Number.isInteger(s) || s < 0 || s > 255) throw new Error(`stat ${i} is not a byte: ${s}`);
    bytes[i] = s;
  }
  const view = new DataView(bytes.buffer);
  for (const [offset, id] of [
    [9, modTemplateId],
    [11, skinTemplateId],
  ]) {
    if (!Number.isInteger(id) || id < 0 || id > 0xffff)
      throw new Error(`template id is not a u16: ${id}`);
    view.setUint16(offset, id, true);
  }
  return toHex(sha256(bytes));
}
