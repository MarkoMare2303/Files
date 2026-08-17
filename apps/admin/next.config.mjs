/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace-Pakete werden als TypeScript-Quelle eingebunden.
  transpilePackages: ['@swissov/ui', '@swissov/types'],
  poweredByHeader: false,

  // Selbsttragende Ausgabe — siehe apps/web/next.config.mjs.
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Sicherheits-Header (§33/§42). Das Admin-Portal lädt keine
          // Fremdinhalte und braucht daher eine sehr enge CSP.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              // Verbindungen nur zur eigenen API und zu Supabase Auth.
              `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL ?? ''} ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}`,
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
            ].join('; '),
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
