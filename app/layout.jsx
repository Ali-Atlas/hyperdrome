import './globals.css';
import { SessionProvider } from '@/hooks/useSession';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata = {
  title: 'Drone Manager',
  description:
    'Competitive idle drone racing - build, optimize, and dominate the circuit.',
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
