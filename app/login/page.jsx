import { redirect } from 'next/navigation';

/**
 * Registration is disabled - PLAY DEMO is the only way in. proxy.js also
 * blocks this route at the edge, but a server-side redirect here gives
 * defense in depth (e.g. if the matcher list ever drifts).
 *
 * The previous magic-link form lives in git history if it ever needs to
 * come back.
 */
export default function LoginPage() {
  redirect('/');
}
