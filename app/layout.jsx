import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { SessionProvider } from '@/hooks/useSession';
import { ToastProvider } from '@/components/ui/Toast';
import Onboarding from '@/components/ui/Onboarding';

export const metadata = {
  title: 'Hyperdrome | Drone Racing Strategy Game',
  description:
    'Level drones, equip skins and mods, race every 3 minutes via ELO matchmaking, trade on a player-driven marketplace.',
  metadataBase: new URL('https://hyperdrome.vercel.app'),
  /* Favicon: Next.js auto-generates the <link rel="icon"> tag from
     `app/icon.svg` (the file-convention path for SVG icons). The
     `favicon` filename convention is .ico only - using .svg under
     that name skips the auto-detection. */
  openGraph: {
    title: 'Hyperdrome | Drone Racing Strategy Game',
    description:
      'Level drones, equip skins and mods, race every 3 minutes via ELO matchmaking, trade on a player-driven marketplace.',
    url: 'https://hyperdrome.vercel.app',
    siteName: 'Hyperdrome',
    type: 'website',
    images: [
      {
        url: '/hero-poster.webp',
        width: 1313,
        height: 627,
        alt: 'Hyperdrome - drone racing strategy game',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hyperdrome | Drone Racing Strategy Game',
    description:
      'Level drones, equip skins and mods, race every 3 minutes via ELO matchmaking, trade on a player-driven marketplace.',
    images: ['/hero-poster.webp'],
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
          <Onboarding />
        </SessionProvider>
        <Analytics />
      </body>
    </html>
  );
}
