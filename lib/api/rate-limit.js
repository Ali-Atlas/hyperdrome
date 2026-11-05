/** @type {Map<string, { start: number, count: number }>} */
const rateMap = new Map();

/**
 * In-process fixed-window limiter for the public read routes.
 * @param {string} ip
 * @param {{ limit?: number, windowMs?: number }} [options]
 * @returns {{ allowed: boolean, remaining: number }}
 */
export function rateLimit(ip, { limit = 500, windowMs = 60000 } = {}) {
  const now = Date.now();
  const record = rateMap.get(ip);

  if (!record || now - record.start > windowMs) {
    rateMap.set(ip, { start: now, count: 1 });
    return { allowed: true, remaining: limit - 1 };
  }

  record.count++;
  if (record.count > limit) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: limit - record.count };
}
