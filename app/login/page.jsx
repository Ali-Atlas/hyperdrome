import { redirect } from 'next/navigation';
import LoginForm from './LoginForm';

/**
 * Login is gated by NODE_ENV: production keeps PLAY DEMO as the only
 * entry point and redirects /login to the landing page; local dev
 * renders the magic-link form so the maintainer can sign in against a
 * local DB. proxy.js mirrors this gate at the edge - this server-side
 * redirect is defense in depth.
 */
export default function LoginPage() {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/');
  }
  return <LoginForm />;
}
