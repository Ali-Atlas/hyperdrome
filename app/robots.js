import { SITE_URL } from '@/lib/site-url';

/**
 * robots.txt (Next.js file convention): the rules of the old `public/robots.txt`, with the sitemap
 * on the site's address (`lib/site-url.js`).
 */
export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
