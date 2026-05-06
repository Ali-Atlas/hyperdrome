'use client';

/**
 * Wallet-connect provider for the MegaETH testnet v2 integration. Wraps the
 * tree in WagmiProvider + QueryClientProvider + RainbowKitProvider so any
 * client component can read wallet state via wagmi hooks (useAccount,
 * useDisconnect, ...) and open the connect modal via RainbowKit's
 * useConnectModal.
 *
 * Wallet connect is additive: it does not replace NextAuth email magic-link
 * sign-in. A user can use the entire app without ever connecting a wallet.
 *
 * Connector list is `injected()` only - browser-extension wallets like
 * MetaMask. WalletConnect mobile (the protocol, not the brand) requires a
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID registered with WalletConnect Cloud
 * and is intentionally deferred until that signup happens.
 */

import { useState } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

/**
 * MegaETH testnet v2. Chain ID 6342 was deprecated; 6343 is the active
 * testnet (verified against docs.megaeth.com + chainlist.org on 2026-05-06).
 * The Carrot RPC host was repointed to v2 by the MegaETH team.
 */
export const megaethTestnetV2 = defineChain({
  id: 6343,
  name: 'Mega Testnet V2',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://carrot.megaeth.com/rpc'] },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://megaeth-testnet-v2.blockscout.com',
    },
  },
  testnet: true,
});

const wagmiConfig = createConfig({
  chains: [megaethTestnetV2],
  connectors: [injected()],
  transports: {
    [megaethTestnetV2.id]: http(),
  },
  // ssr:true defers the initial connector-state read (localStorage / mipd)
  // so the server-rendered HTML matches the first client paint, eliminating
  // hydration warnings on routes that mount this provider.
  ssr: true,
});

// CSS-variable pass-through to the design system. RainbowKit forwards these
// theme tokens to its internal `[data-rk]` CSS custom properties; consumer
// `var()` references resolve at the theme root and pick up the values from
// app/globals.css.
const rkTheme = darkTheme({
  accentColor: 'var(--accent-primary)',
  accentColorForeground: 'var(--bg-primary)',
  borderRadius: 'medium',
});

/**
 * @param {{ children: React.ReactNode }} props
 */
export default function WalletProvider({ children }) {
  // QueryClient is created once per component mount (state, not module
  // scope) so dev-time hot reloads don't share a stale cache across
  // remounts.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rkTheme}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
