/**
 * NEP-413 verification (lib/near/wallet-signature.js, SPEC.md 6): the NEP's example payload signed
 * over an independently built digest, then the refusals a wallet link depends on.
 */
import { createHash } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- test signs NEP-413 with a real ed25519 key
import { KeyPair } from 'near-api-js';
import { describe, expect, it } from 'vitest';
import { verifyNep413 } from '../../lib/near/wallet-signature.js';

/** The NEP's example: message "hi", nonce [0..31], recipient "myapp.com", the callback below. */
const NONCE = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
const MESSAGE = 'hi';
const RECIPIENT = 'myapp.com';
const CALLBACK = 'myapp.com/callback';
const ACCOUNT = 'alice.testnet';

/** @param {string} s */
const borshString = (s) => {
  const bytes = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
};

/**
 * sha256(borsh u32 2^31 + 413 ++ borsh payload), built by hand from the NEP's layout.
 * @param {{ message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string }} p
 */
function nep413Digest({ message, nonce, recipient, callbackUrl }) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(2147484061);
  const callback = callbackUrl
    ? Buffer.concat([Buffer.from([1]), borshString(callbackUrl)])
    : Buffer.from([0]);
  const payload = Buffer.concat([
    prefix,
    borshString(message),
    Buffer.from(nonce),
    borshString(recipient),
    callback,
  ]);
  return createHash('sha256').update(payload).digest();
}

/**
 * @param {any} keyPair
 * @param {{ message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string }} p
 */
const sign = (keyPair, p) =>
  Buffer.from(keyPair.sign(nep413Digest(p)).signature).toString('base64');

/** @param {'FullAccess' | { FunctionCall: object }} permission */
const providerWith = (permission) => ({
  viewAccessKey: async () => /** @type {any} */ ({ permission }),
});

describe('verifyNep413', () => {
  const keyPair = KeyPair.fromRandom('ed25519');
  const publicKey = keyPair.getPublicKey().toString();
  const base = { accountId: ACCOUNT, publicKey, nonce: NONCE, recipient: RECIPIENT };

  it('accepts the NEP example signed over the digest built by hand', async () => {
    const signature = sign(keyPair, {
      message: MESSAGE,
      nonce: NONCE,
      recipient: RECIPIENT,
      callbackUrl: CALLBACK,
    });
    const input = { ...base, signature, message: MESSAGE, callbackUrl: CALLBACK };
    expect(await verifyNep413(providerWith('FullAccess'), input)).toBe(true);
  });

  it('refuses a wrong nonce and a wrong recipient', async () => {
    const payload = { message: MESSAGE, nonce: NONCE, recipient: RECIPIENT };
    const signature = sign(keyPair, payload);
    const provider = providerWith('FullAccess');
    expect(await verifyNep413(provider, { ...base, signature, message: MESSAGE })).toBe(true);

    const otherNonce = new Uint8Array(NONCE);
    otherNonce[0] = 9;
    expect(
      await verifyNep413(provider, { ...base, signature, message: MESSAGE, nonce: otherNonce })
    ).toBe(false);
    expect(
      await verifyNep413(provider, { ...base, signature, message: MESSAGE, recipient: 'evil.com' })
    ).toBe(false);
  });

  it('refuses a function-call key', async () => {
    const signature = sign(keyPair, { message: MESSAGE, nonce: NONCE, recipient: RECIPIENT });
    const provider = providerWith({
      FunctionCall: { allowance: '1', receiver_id: 'x', method_names: [] },
    });
    expect(await verifyNep413(provider, { ...base, signature, message: MESSAGE })).toBe(false);
  });

  it("refuses another account's key and a bad signature shape", async () => {
    const signature = sign(keyPair, { message: MESSAGE, nonce: NONCE, recipient: RECIPIENT });
    const provider = {
      viewAccessKey: async () => {
        throw new Error('public key does not have FullAccess permission on account');
      },
    };
    expect(await verifyNep413(provider, { ...base, signature, message: MESSAGE })).toBe(false);
    expect(
      await verifyNep413(providerWith('FullAccess'), {
        ...base,
        signature: 'aGk=',
        message: MESSAGE,
      })
    ).toBe(false);
  });

  it('an RPC failure throws instead of reading as a bad signature', async () => {
    const signature = sign(keyPair, { message: MESSAGE, nonce: NONCE, recipient: RECIPIENT });
    const provider = {
      viewAccessKey: async () => {
        throw new Error('fetch failed');
      },
    };
    await expect(verifyNep413(provider, { ...base, signature, message: MESSAGE })).rejects.toThrow(
      'fetch failed'
    );
  });
});
