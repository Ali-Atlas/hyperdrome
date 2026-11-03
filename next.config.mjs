/** Sent on every response (ENGINEERING.md 4, SPEC.md 14). */
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,

  /**
   * Next.js 16.3+ rewrites a managed block into AGENTS.md on `next dev` when it detects a
   * coding agent. AGENTS.md already carries the Next.js 16 rule, so keep it hand-written.
   */
  agentRules: false,

  /**
   * Long-cache static assets. Captain's spec used the v15 pattern
   * `/:path*\\.(webp|png|...)` with an unnamed regex group, which v6
   * path-to-regexp (Next.js 16) rejects. Bound the group to a named
   * `:ext` param instead so the pattern actually matches.
   * Path-to-regexp doc: regex groups must associate with a parameter.
   */
  async headers() {
    return [
      {
        // Security headers on every route (ENGINEERING.md 4). Values from the Next.js 16
        // headers guide; HSTS without `preload`, which needs a registrable domain we own.
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      {
        source: '/:slug*.:ext(webp|png|jpg|svg|mp4|woff2)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
