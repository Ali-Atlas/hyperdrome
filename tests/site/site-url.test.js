/**
 * The site's address as one setting (lib/site-url.js, SPEC.md 15), and the sitemap and robots
 * built on it.
 */
import { describe, expect, it } from 'vitest';
import robots from '../../app/robots.js';
import sitemap from '../../app/sitemap.js';
import { DEFAULT_SITE_URL, SITE_URL, siteUrlFrom } from '../../lib/site-url.js';

describe('siteUrlFrom', () => {
  it('is the hosted build when unset or blank', () => {
    expect(siteUrlFrom(undefined)).toBe('https://hyperdrome-near.vercel.app');
    expect(siteUrlFrom('  ')).toBe(DEFAULT_SITE_URL);
  });

  it('keeps the origin only, so a trailing slash or path never doubles a slash', () => {
    expect(siteUrlFrom('https://hyperdrome.com/')).toBe('https://hyperdrome.com');
    expect(siteUrlFrom('https://hyperdrome.com/play?x=1')).toBe('https://hyperdrome.com');
    expect(siteUrlFrom('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('refuses anything but an http(s) URL', () => {
    expect(() => siteUrlFrom('hyperdrome.com')).toThrow(/not a URL/);
    expect(() => siteUrlFrom('ftp://hyperdrome.com')).toThrow(/http or https/);
  });
});

describe('sitemap and robots', () => {
  it('put every URL on the site address', () => {
    const urls = sitemap().map((/** @type {{ url: string }} */ e) => e.url);
    expect(urls).toEqual([
      SITE_URL,
      `${SITE_URL}/economy`,
      `${SITE_URL}/tracks`,
      `${SITE_URL}/guide`,
      `${SITE_URL}/faq`,
      `${SITE_URL}/privacy`,
    ]);
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] },
      sitemap: `${SITE_URL}/sitemap.xml`,
    });
  });
});
