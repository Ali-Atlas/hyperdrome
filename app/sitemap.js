/**
 * Next.js sitemap. Public routes only.
 *
 * `/login`, `/register`, `/signup` are excluded - proxy.js redirects them
 * to `/`. Protected routes (dashboard, drones, marketplace, admin, etc.)
 * are excluded so search engines don't crawl private URLs.
 */
const BASE = 'https://hyperdrome.vercel.app';

export default function sitemap() {
  const now = new Date();
  return [
    { url: BASE, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/guide`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
