import './globals.css';
import { SessionProvider } from '@/hooks/useSession';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata = {
  title: 'Hyperdrome - Drone Racing Strategy Game',
  description:
    'Build your fleet, equip legendary skins and mods, race every 3 minutes, trade on a player-driven marketplace. By Dendrite Games.',
  metadataBase: new URL('https://hyperdrome.vercel.app'),
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: 'Hyperdrome - Drone Racing Strategy Game',
    description: 'Build. Race. Trade. Collect.',
    url: 'https://hyperdrome.vercel.app',
    siteName: 'Hyperdrome',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hyperdrome',
    description: 'Drone racing strategy game by Dendrite Games',
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Root layout. Every route in the app tree is rendered inside this layout.
 * @param {{ children: React.ReactNode }} props
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
