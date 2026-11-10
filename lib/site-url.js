/**
 * The site's own address (SPEC.md 15): `NEXT_PUBLIC_SITE_URL`, else the hosted build. Everything
 * the app writes as an absolute link to itself reads it: `metadataBase`, `og:url` and so `og:image`,
 * the sitemap, robots, and token metadata. Next.js inlines `NEXT_PUBLIC_` values at build time, so
 * a new value takes a rebuild (a redeploy on Vercel). Request-bound checks (the Origin check, the
 * NEP-413 recipient) keep using the address the request came to.
 */

export const DEFAULT_SITE_URL = 'https://hyperdrome-near.vercel.app';

/**
 * The origin of `raw`, without a trailing slash. Throws on anything but an http(s) URL, so a bad
 * value fails the build instead of shipping broken links.
 * @param {string | undefined} raw
 * @returns {string}
 */
export function siteUrlFrom(raw) {
  const value = raw?.trim() || DEFAULT_SITE_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is not a URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`NEXT_PUBLIC_SITE_URL must be http or https: ${value}`);
  }
  return url.origin;
}

/** The site's origin, e.g. `https://hyperdrome-near.vercel.app`. */
export const SITE_URL = siteUrlFrom(process.env.NEXT_PUBLIC_SITE_URL);
