/**
 * Origin check for every mutation route (ENGINEERING.md 4, SPEC.md 8). A request passes when its
 * `Origin` header equals the origin the request was addressed to. A missing `Origin` fails:
 * browsers send it on every cross-site and same-site POST.
 */

/**
 * The origins a mutation may come from.
 * @param {Request} request
 * @returns {Set<string>}
 */
export function allowedOrigins(request) {
  return new Set([new URL(request.url).origin]);
}

/**
 * Reject a cross-origin mutation.
 * @param {Request} request
 * @returns {Response | null} a 403 response, or null when the origin is allowed
 */
export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins(request).has(origin)) return null;
  return Response.json({ error: 'Bad origin' }, { status: 403 });
}
