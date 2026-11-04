import { auth } from '@/lib/auth';

/**
 * The signed-in user for a route, or a 401 response (SPEC.md 8: every mutation needs a session).
 * @returns {Promise<{ userId: string, session: import('next-auth').Session } | Response>}
 */
export async function requireSession() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session || !userId) return Response.json({ error: 'Not authenticated' }, { status: 401 });
  return { userId, session };
}
