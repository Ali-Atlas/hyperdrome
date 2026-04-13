/**
 * Next.js sitemap. Only public routes.
 * Protected routes (dashboard, drones, marketplace, etc.) are excluded so
 * search engines don't try to crawl private URLs.
 */
export default function sitemap() {
  const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
