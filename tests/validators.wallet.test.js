/**
 * Zod schemas for the wallet mutation bodies (lib/validators/wallet.js, SPEC.md 8).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  challengeBodySchema,
  linkBodySchema,
  syncBodySchema,
  withdrawBodySchema,
} from '../lib/validators/wallet.js';

const actionId = randomUUID();
const nonce = 'ab'.repeat(32);
const signature = Buffer.alloc(64, 7).toString('base64');
const publicKey = 'ed25519:6TupyNrcHGTt5XRLmHTc2KGaiSbjhQi1KHtCXTgbcr4Y';
/** @param {import('zod').ZodType} schema @param {unknown} body */
const ok = (schema, body) => schema.safeParse(body).success;

describe('wallet body schemas', () => {
  it('challenge and sync take an empty object', () => {
    expect(ok(challengeBodySchema, {})).toBe(true);
    expect(ok(challengeBodySchema, { x: 1 })).toBe(false);
    expect(ok(syncBodySchema, {})).toBe(true);
    expect(ok(syncBodySchema, { x: 1 })).toBe(false);
  });

  it('link needs a NEAR account, an ed25519 key, a base64 signature and a hex nonce', () => {
    const body = { accountId: 'alice.testnet', publicKey, signature, nonce };
    expect(ok(linkBodySchema, body)).toBe(true);
    expect(ok(linkBodySchema, { ...body, accountId: 'Bad Account' })).toBe(false);
    expect(ok(linkBodySchema, { ...body, publicKey: 'secp256k1:abc' })).toBe(false);
    expect(ok(linkBodySchema, { ...body, nonce: 'zz' })).toBe(false);
    expect(ok(linkBodySchema, { ...body, signature: 'not base64!' })).toBe(false);
    expect(ok(linkBodySchema, { ...body, extra: 1 })).toBe(false);
  });

  it('withdraw needs a uuid, tokens or Volts, and whole non-negative Volts', () => {
    expect(ok(withdrawBodySchema, { actionId, tokens: ['d:1', 's:2'], volts: 0 })).toBe(true);
    expect(ok(withdrawBodySchema, { actionId, tokens: [], volts: 5 })).toBe(true);
    expect(ok(withdrawBodySchema, { actionId, tokens: [], volts: 0 })).toBe(false);
    expect(ok(withdrawBodySchema, { actionId, tokens: ['nope'], volts: 1 })).toBe(false);
    expect(ok(withdrawBodySchema, { actionId, tokens: [], volts: 1.5 })).toBe(false);
    expect(ok(withdrawBodySchema, { actionId, tokens: [], volts: -1 })).toBe(false);
    expect(ok(withdrawBodySchema, { tokens: ['d:1'], volts: 0 })).toBe(false);
  });
});
