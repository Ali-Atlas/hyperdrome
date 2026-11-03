/**
 * Chain adapter configuration (SPEC.md 15). Read from the environment once, validated with Zod.
 * Secrets (`NEAR_OPS_KEY`, `NEAR_SETTLEMENT_KEY`, the two encryption keys) stay in this object and
 * are never logged.
 */

import { z } from 'zod';

const hex64 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)');
const secretKey = z
  .string()
  .regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/, 'must be an ed25519:<base58> key');
const accountId = z
  .string()
  .regex(
    /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/,
    'must be a NEAR account id'
  );

/** Primary RPC: dRPC's public testnet endpoint, keyless (DECISIONS.md 2.21). */
export const DEFAULT_RPC_URL = 'https://near-testnet.drpc.org';
/** Failover RPC: FastNear testnet, keyless unless NEAR_RPC_API_KEY is set. */
export const DEFAULT_RPC_FAILOVER_URL = 'https://test.rpc.fastnear.com';

/** Adapter selection: `mock` for tests and local work without RPC, `real` otherwise. */
export const adapterKindSchema = z.enum(['real', 'mock']).default('real');

export const configSchema = z.object({
  network: z.enum(['testnet', 'mainnet']),
  rpcUrl: z.url().default(DEFAULT_RPC_URL),
  /** FastNear key, sent as `Authorization: Bearer` to whichever RPC URL is FastNear; optional. */
  rpcApiKey: z.string().min(1).optional(),
  rpcFailoverUrl: z.url().default(DEFAULT_RPC_FAILOVER_URL),
  ownerId: accountId,
  gameId: accountId,
  opsKey: secretKey,
  settlementKey: secretKey,
  keyEncryptionKey: hex64,
  adminKeyEncryptionKey: hex64,
  explorerUrl: z.url(),
});

/** @typedef {z.infer<typeof configSchema>} NearConfig */

/**
 * Validated adapter config from `env`. Throws a `ZodError` naming every bad or missing variable
 * (values are never included).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NearConfig}
 */
export function readConfig(env = process.env) {
  const parsed = configSchema.safeParse({
    network: env.NEAR_NETWORK,
    rpcUrl: env.NEAR_RPC_URL || undefined,
    rpcApiKey: env.NEAR_RPC_API_KEY || undefined,
    rpcFailoverUrl: env.NEAR_RPC_FAILOVER_URL || undefined,
    ownerId: env.NEAR_OWNER_ID,
    gameId: env.NEAR_GAME_ID,
    opsKey: env.NEAR_OPS_KEY,
    settlementKey: env.NEAR_SETTLEMENT_KEY,
    keyEncryptionKey: env.KEY_ENCRYPTION_KEY,
    adminKeyEncryptionKey: env.ADMIN_KEY_ENCRYPTION_KEY,
    explorerUrl: env.NEXT_PUBLIC_EXPLORER_URL,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`invalid NEAR adapter config: ${fields.join('; ')}`);
  }
  return parsed.data;
}

/**
 * `real` or `mock`, from `NEAR_ADAPTER`.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'real' | 'mock'}
 */
export function readAdapterKind(env = process.env) {
  return adapterKindSchema.parse(env.NEAR_ADAPTER);
}
