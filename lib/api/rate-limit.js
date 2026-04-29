const rateMap = new Map();

export function rateLimit(ip, { limit = 60, windowMs = 60000 } = {}) {
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
