/**
 * Content-Security-Policy for the wallet page (SPEC.md 8), the one page that runs third-party
 * wallet code. Every origin is listed by name and read from its source; no wildcards.
 *
 * - Manifest: `defaultManifests` in `@hot-labs/near-connect` 0.12.0 `build/NearConnector.js`.
 * - Executors: the `executor` URLs of the wallets its manifest lists with `signMessage` and
 *   `testnet` (Meteor, Intear, Ledger, Nightly, NEAR CLI). WalletConnect wallets are not offered:
 *   they need a WalletConnect client, which this app does not configure.
 * - Wallet code runs in `srcdoc` iframes that inherit this policy, so what those executors connect
 *   to is listed too (hosts read from their published code); icons come from their manifest
 *   entries. A wallet added to the manifest later needs its origins added here.
 */

/** @type {readonly string[]} */
const MANIFEST_AND_EXECUTOR_ORIGINS = [
  'https://raw.githubusercontent.com',
  'https://cdn.jsdelivr.net',
  'https://wallet.intear.tech',
];

/** RPC and backend hosts the executors above call on testnet. */
const WALLET_CONNECT_ORIGINS = [
  'wss://logout-bridge-service.intear.tech',
  'wss://mc.meteorwallet.app',
  'https://logout-bridge-service.intear.tech',
  'https://wallet.meteorwallet.app',
  'https://meteorwallet.app',
  'https://mc.meteorwallet.app',
  'https://test.rpc.fastnear.com',
  'https://free.rpc.fastnear.com',
  'https://api.testnet.fastnear.com',
  'https://rpc.testnet.near.org',
  'https://helper.testnet.near.org',
];

/** Wallet icons from the manifest. */
const IMAGE_ORIGINS = [
  'https://raw.githubusercontent.com',
  'https://storage.herewallet.app',
  'https://meteorwallet.app',
];

/** Wallet UI fonts and styles the executors load (cosmetic, hosts read from their code). */
const WALLET_STYLE_ORIGINS = ['https://rsms.me', 'https://fonts.cdnfonts.com'];
const WALLET_FONT_ORIGINS = ['https://rsms.me', 'https://fonts.cdnfonts.com'];

/** The Intear bridge page its executor frames, and mobile-app deep links opened through a hidden frame by `open.nativeApp`. */
const FRAME_SOURCES = [
  'https://wallet.intear.tech',
  'meteorwallet:',
  'meteorwalletdev:',
  'intear:',
];

/**
 * The wallet page's Content-Security-Policy value.
 * @param {string} nonce the per-request script nonce (also passed to NearConnector, so its
 *   `srcdoc` scripts run)
 * @param {{ dev?: boolean }} [options] React needs `unsafe-eval` in development only
 * @returns {string}
 */
export function walletPageCsp(nonce, { dev = false } = {}) {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // NEAR Connect's modal and wallet iframes use unnonced inline `<style>` blocks.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${WALLET_STYLE_ORIGINS.join(' ')}`,
    `font-src 'self' data: https://fonts.gstatic.com ${WALLET_FONT_ORIGINS.join(' ')}`,
    `img-src 'self' data: blob: ${IMAGE_ORIGINS.join(' ')}`,
    `connect-src 'self' ${[...MANIFEST_AND_EXECUTOR_ORIGINS, ...WALLET_CONNECT_ORIGINS].join(' ')}`,
    `frame-src 'self' ${FRAME_SOURCES.join(' ')}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}
