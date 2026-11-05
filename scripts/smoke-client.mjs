/**
 * The HTTP client and the assertion ledger of the smoke test (scripts/smoke-testnet.mjs): requests
 * carry a cookie jar and the Origin header a browser sends, and every assertion is recorded for the
 * report or stops the run.
 */

/** The app under test. */
export const base = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:3000');
/** The pause before a request is sent again. */
export const RETRY_MS = 3_000;
const REQUEST_TIMEOUT_MS = 120_000;

/** @type {Map<string, string>} */
const jar = new Map();
/** The assertions that passed, in order. @type {string[]} */
export const passed = [];

/** Whether a sign-in has set a cookie. */
export const hasSession = () => jar.size > 0;

/** @param {string} line */
export const say = (line) => void process.stdout.write(`${line}\n`);
/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A failed assertion: `name` is what the report names. */
export class SmokeFailure extends Error {
  /**
   * @param {string} name
   * @param {string} detail
   */
  constructor(name, detail) {
    super(detail);
    this.assertion = name;
  }
}

/**
 * Record a passed assertion or stop the run on a failed one.
 * @param {string} name
 * @param {unknown} condition
 * @param {string} detail what was seen, shown when the assertion fails
 * @returns {asserts condition}
 */
export function check(name, condition, detail) {
  if (!condition) throw new SmokeFailure(name, detail);
  passed.push(name);
}

/**
 * One request with the cookie jar and the Origin header a browser sends.
 * @param {'GET' | 'POST'} method
 * @param {string} path
 * @param {{ body?: unknown, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, json: any, text: string, date: number }>} `date` is the
 *   server's clock from the `Date` header (this machine's when the header is missing)
 */
export async function call(method, path, { body, headers = {} } = {}) {
  const res = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    headers: {
      origin: base.origin,
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  for (const cookie of res.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const at = pair.indexOf('=');
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (an HTML error page): the caller reports `text`.
  }
  return {
    status: res.status,
    json,
    text,
    date: Date.parse(res.headers.get('date') ?? '') || Date.now(),
  };
}

/** @param {{ status: number, json: any, text: string }} res */
export const seen = (res) => `HTTP ${res.status} ${res.json?.error ?? res.text.slice(0, 200)}`;
