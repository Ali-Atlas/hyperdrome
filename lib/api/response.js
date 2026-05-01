import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/api/rate-limit.js';

/**
 * The cron endpoint is server-to-server (Vercel cron + internal scripts)
 * and protected by CRON_SECRET; rate limiting it would risk legitimate
 * cron ticks getting throttled if multiple instances share an IP.
 */
const RATE_LIMIT_EXEMPT_PATHS = new Set(['/api/races/run']);

function getClientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  return request.ip || 'unknown';
}

/**
 * Thrown by service functions to signal a non-500 error with a specific HTTP status.
 * Caught in `withApiHandler` and translated to a JSON error response.
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [status=500]
   * @param {any} [details]
   */
  constructor(message, status = 500, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** JSON success response. */
export function ok(data, status = 200) {
  return Response.json({ data }, { status });
}

/** JSON error response. */
export function fail(message, status = 500, details) {
  const body = details !== undefined ? { error: message, details } : { error: message };
  return Response.json(body, { status });
}

/**
 * Wrap an API route handler with auth check + consistent error handling.
 * The wrapped function receives `{ session, params, request }`.
 *
 * @param {(ctx: { session: any, params: any, request: Request }) => Promise<Response>} handler
 * @param {{ requireAuth?: boolean }} [options]
 */
export function withApiHandler(handler, options = {}) {
  const { requireAuth = true } = options;
  return async (request, context) => {
    try {
      const pathname = new URL(request.url).pathname;
      if (!RATE_LIMIT_EXEMPT_PATHS.has(pathname)) {
        const ip = getClientIp(request);
        const { allowed } = rateLimit(ip, { limit: 500, windowMs: 60000 });
        if (!allowed) {
          return fail('Too many requests', 429);
        }
      }

      let session = null;
      if (requireAuth) {
        session = await auth();
        if (!session?.user?.id) {
          return fail('Not authenticated', 401);
        }
      }
      const params = context?.params ? await context.params : undefined;
      return await handler({ session, params, request });
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.message, err.status, err.details);
      }
      console.error('[api] unhandled error:', err);
      return fail('Internal server error', 500);
    }
  };
}
