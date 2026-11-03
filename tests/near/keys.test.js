import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SEAL_VERSION,
  generateKeyPair,
  openKey,
  openSecret,
  sealKey,
  sealSecret,
} from '../../lib/near/keys.js';

const keyHex = () => randomBytes(32).toString('hex');

describe('sealSecret / openSecret (AES-256-GCM)', () => {
  const key = keyHex();
  const secret = new Uint8Array(randomBytes(48));

  it('round-trips and lays the blob out as version ++ IV ++ tag ++ ciphertext', () => {
    const blob = sealSecret(secret, key, 'p-alice.game.testnet');
    const raw = Buffer.from(blob, 'base64');
    expect(raw[0]).toBe(SEAL_VERSION);
    expect(raw.length).toBe(1 + 12 + 16 + secret.length);
    expect(Buffer.from(openSecret(blob, key, 'p-alice.game.testnet'))).toEqual(Buffer.from(secret));
    expect(sealSecret(secret, key, 'p-alice.game.testnet')).not.toBe(blob);
  });

  it('fails with the wrong key', () => {
    const blob = sealSecret(secret, key, 'a');
    expect(() => openSecret(blob, keyHex(), 'a')).toThrow();
  });

  it('fails when the tag or ciphertext is tampered with', () => {
    const raw = Buffer.from(sealSecret(secret, key, 'a'), 'base64');
    const badTag = Buffer.from(raw);
    badTag[1 + 12] ^= 0x01;
    expect(() => openSecret(badTag.toString('base64'), key, 'a')).toThrow();
    const badBody = Buffer.from(raw);
    badBody[raw.length - 1] ^= 0x01;
    expect(() => openSecret(badBody.toString('base64'), key, 'a')).toThrow();
  });

  it('fails with a different AAD, so a blob moved to another row does not open', () => {
    const blob = sealSecret(secret, key, 'p-alice.game.testnet');
    expect(() => openSecret(blob, key, 'p-bob.game.testnet')).toThrow();
  });

  it('rejects an unknown version byte and a short blob', () => {
    const raw = Buffer.from(sealSecret(secret, key, 'a'), 'base64');
    raw[0] = 2;
    expect(() => openSecret(raw.toString('base64'), key, 'a')).toThrow(/version 2/);
    expect(() => openSecret(Buffer.from([1, 2, 3]).toString('base64'), key, 'a')).toThrow(
      /too short/
    );
  });

  it('rejects a malformed encryption key', () => {
    expect(() => sealSecret(secret, 'abc', 'a')).toThrow(/64 hex/);
  });
});

describe('ed25519 keys', () => {
  it('generates keypairs locally and seals the secret per account', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.secretKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
    expect(a.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
    expect(a.secretKey).not.toBe(b.secretKey);
    const key = keyHex();
    const blob = sealKey(a.secretKey, key, 'p-x.game.testnet');
    expect(openKey(blob, key, 'p-x.game.testnet')).toBe(a.secretKey);
    expect(() => openKey(blob, key, 'p-y.game.testnet')).toThrow();
  });
});
