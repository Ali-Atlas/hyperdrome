import { SITE_URL } from '@/lib/site-url';

/**
 * Next.js sitemap: every page that renders without signing in and is meant to be found, on the
 * site's address (`lib/site-url.js`). Public means outside the `proxy.js` matcher, whose pages
 * redirect a visitor without a session to `/` (dashboard, drones, races, leaderboard, marketplace,
 * wallet, profile, admin). `/login` is public but only a sign-in step; track and drone detail pages
 * are reached through links and are not listed one by one.
 */
const BASE = SITE_URL;

export default function sitemap() {
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/economy`, lastModified: now, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${BASE}/tracks`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/guide`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
