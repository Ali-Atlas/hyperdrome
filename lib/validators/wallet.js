/**
 * Zod schemas for the wallet routes (SPEC.md 8). Bodies are strict: unknown keys fail. The contract
 * enforces the withdrawal limit and every rule again; these bound what reaches it.
 */
import { z } from 'zod';
import { actionIdSchema, tokenIdSchema } from './gameplay.js';

/** NEAR account ids: 2 to 64 characters, lowercase, separated by `-`, `_` or `.`. */
export const nearAccountIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, 'not a NEAR account id');

/** The contract refuses more; this bounds the request (SPEC.md 13). */
const MAX_REQUEST_TOKENS = 100;

/** POST /api/wallet/challenge. */
export const challengeBodySchema = z.strictObject({});

/** POST /api/wallet/link: the NEP-413 answer to a challenge. */
export const linkBodySchema = z.strictObject({
  accountId: nearAccountIdSchema,
  publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/, 'not an ed25519 key'),
  signature: z.base64().max(128),
  nonce: z.string().regex(/^[0-9a-f]{64}$/, 'not a challenge nonce'),
});

/** POST /api/wallet/withdraw: tokens and whole Volts, at least one of them. */
export const withdrawBodySchema = z
  .strictObject({
    actionId: actionIdSchema,
    tokens: z.array(tokenIdSchema).max(MAX_REQUEST_TOKENS),
    volts: z.number().int().min(0).max(2_000_000_000),
  })
  .refine((b) => b.tokens.length > 0 || b.volts > 0, {
    message: 'nothing to withdraw',
    path: ['tokens'],
  });

/** POST /api/wallet/sync. */
export const syncBodySchema = z.strictObject({});
