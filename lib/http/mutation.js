/**
 * The guard every gameplay mutation route runs (SPEC.md 8, ENGINEERING.md 4), in order: Origin
 * check, session, the per-user rate limit in the database, then the Zod-validated JSON body. The
 * handler returns `{ status, body }` (services/action.service.js) and gets a JSON response.
 */
import { checkOrigin } from '@/lib/http/origin.js';
import { requireSession } from '@/lib/http/session.js';
import { hitMutationLimit } from '@/services/rate-limit.service.js';

/**
 * @template T
 * @param {Request} request
 * @param {import('zod').ZodType<T>} schema
 * @param {(ctx: { userId: string, body: T }) => Promise<{ status: number, body: unknown }>} handler
 * @returns {Promise<Response>}
 */
export async function handleMutation(request, schema, handler) {
  const bad = checkOrigin(request);
  if (bad) return bad;
  const who = await requireSession();
  if (who instanceof Response) return who;
  if (!(await hitMutationLimit(who.userId))) {
    return Response.json(
      { error: 'Too many actions. Wait a minute and try again.' },
      { status: 429 }
    );
  }

  /** @type {unknown} */
  let raw;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: 'The request body must be JSON.' }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request.', issues: parsed.error.issues.map((i) => i.path.join('.')) },
      { status: 400 }
    );
  }

  try {
    const { status, body } = await handler({ userId: who.userId, body: parsed.data });
    return Response.json(body, { status });
  } catch (err) {
    console.error({
      scope: 'api',
      msg: 'mutation failed',
      path: new URL(request.url).pathname,
      err: String(err),
    });
    return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  }
}
