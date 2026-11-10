import { SITE_URL } from '@/lib/site-url';

/**
 * Next.js sitemap. Public routes only, on the site's address (`lib/site-url.js`).
 *
 * Auth entry points (CONNECT WALLET / PLAY DEMO) live on the landing page;
 * legacy `/login`, `/register`, `/signup` paths still bounce to `/` via
 * proxy.js for any stale bookmarks. Protected routes (dashboard, drones,
 * marketplace, admin, etc.) are excluded so search engines don't crawl
 * private URLs.
 */
const BASE = SITE_URL;

export default function sitemap() {
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/guide`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
