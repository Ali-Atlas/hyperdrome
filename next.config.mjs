/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,

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
