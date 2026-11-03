/**
 * Secret sealing (SPEC.md 6, ENGINEERING.md 4): AES-256-GCM with a 12-byte IV and a 16-byte tag.
 * Blob = base64(version byte ++ IV ++ tag ++ ciphertext). The AAD binds a blob to its row (the
 * account id for player keys, the batch slot for seeds), so a blob copied elsewhere fails to open.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KeyPair } from 'near-api-js';

/**
 * A fresh ed25519 keypair, generated locally.
 * @returns {{ secretKey: import('near-api-js').KeyPairString, publicKey: string }}
 */
export function generateKeyPair() {
  const pair = KeyPair.fromRandom('ed25519');
  return { secretKey: pair.toString(), publicKey: pair.getPublicKey().toString() };
}

/**
 * Seals a secret key string for storage on the account's row.
 * @param {string} secretKey `ed25519:...`
 * @param {string} keyHex 64-hex encryption key
 * @param {string} accountId AAD
 * @returns {string}
 */
export function sealKey(secretKey, keyHex, accountId) {
  return sealSecret(new TextEncoder().encode(secretKey), keyHex, accountId);
}

/**
 * Opens a key sealed with `sealKey`.
 * @param {string} blob
 * @param {string} keyHex
 * @param {string} accountId AAD
 * @returns {import('near-api-js').KeyPairString}
 */
export function openKey(blob, keyHex, accountId) {
  const text = new TextDecoder().decode(openSecret(blob, keyHex, accountId));
  if (!text.startsWith('ed25519:')) throw new Error('sealed key is not an ed25519 key');
  return /** @type {import('near-api-js').KeyPairString} */ (text);
}

export const SEAL_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

/**
 * The 32-byte AES key from a 64-hex string.
 * @param {string} keyHex
 * @returns {Buffer}
 */
function aesKey(keyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex))
    throw new Error('encryption key must be 64 hex characters');
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts `bytes` under `keyHex`, bound to `aad`.
 * @param {Uint8Array} bytes plaintext
 * @param {string} keyHex 64 hex characters
 * @param {string} aad associated data, e.g. the account id
 * @returns {string} base64 blob
 */
export function sealSecret(bytes, keyHex, aad) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', aesKey(keyHex), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([SEAL_VERSION]), iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypts a blob from `sealSecret`. Throws on an unknown version, a wrong key, a wrong `aad` or
 * any tampering.
 * @param {string} blob base64
 * @param {string} keyHex 64 hex characters
 * @param {string} aad the same associated data used to seal
 * @returns {Uint8Array} plaintext
 */
export function openSecret(blob, keyHex, aad) {
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < HEADER_BYTES) throw new Error('sealed secret is too short');
  if (raw[0] !== SEAL_VERSION) throw new Error(`unknown sealed secret version ${raw[0]}`);
  const iv = raw.subarray(1, 1 + IV_BYTES);
  const tag = raw.subarray(1 + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', aesKey(keyHex), iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return new Uint8Array(
    Buffer.concat([decipher.update(raw.subarray(HEADER_BYTES)), decipher.final()])
  );
}
