import WalletView from './WalletView';

/** Rendered per request so Next.js applies the proxy's script nonce (SPEC.md 8). */
export const dynamic = 'force-dynamic';

/** "Your wallet" (SPEC.md 11). */
export default function WalletPage() {
  return <WalletView />;
}
