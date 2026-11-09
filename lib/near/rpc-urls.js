/** Public NEAR RPC endpoints (SPEC.md 15, DECISIONS.md 2.21). No dependencies, so the browser can import them. */

/** Primary RPC: dRPC's public testnet endpoint, keyless. */
export const DEFAULT_RPC_URL = 'https://near-testnet.drpc.org';
/** Failover RPC: FastNear testnet, keyless unless NEAR_RPC_API_KEY is set. */
export const DEFAULT_RPC_FAILOVER_URL = 'https://test.rpc.fastnear.com';
/** FastNear's archival testnet node: regular nodes keep a transaction for a few days only. */
export const ARCHIVAL_RPC_URL = 'https://archival-rpc.testnet.fastnear.com';
