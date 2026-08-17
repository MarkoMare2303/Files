/**
 * Next.js-Konfiguration der PWA.
 *
 * Sicherheits-Header und Caching-Regeln stehen hier, damit sie auch dann
 * greifen, wenn die App hinter einem beliebigen Reverse Proxy läuft.
 */

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const mapStyleUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? '';

/** Nur Ursprung (Schema + Host + Port) einer URL — CSP kennt keine Pfade in connect-src. */
function origin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

/** Supabase Realtime läuft über WebSockets auf demselben Host. */
function websocket(value) {
  const parsed = origin(value);
  if (!parsed) return '';
  return parsed.replace(/^http/, 'ws');
}

const connectSrc = [
  "'self'",
  origin(apiUrl),
  origin(supabaseUrl),
  websocket(supabaseUrl),
  // Kartenkacheln werden per fetch/XHR nachgeladen.
  origin(mapStyleUrl),
]
  .filter(Boolean)
  .join(' ');

const imgSrc = ["'self'", 'data:', 'blob:', origin(mapStyleUrl)].filter(Boolean).join(' ');

const csp = [
  "default-src 'self'",
  // MapLibre erzeugt seine Worker aus Blobs; ohne blob: rendert keine Karte.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src ${imgSrc}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@swissov/ui', '@swissov/types', '@swissov/shared'],
  poweredByHeader: false,

  /**
   * Selbsttragende Ausgabe für die Auslieferung.
   *
   * `standalone` legt unter `.next/standalone` einen Server samt genau der
   * benötigten Abhängigkeiten ab. Ohne diese Zeile bräuchte der Zielserver das
   * gesamte pnpm-Workspace mitsamt `workspace:*`-Verweisen — die sich auf einem
   * Webserver nicht auflösen lassen, weil es diese Pakete in keiner Registry
   * gibt. Siehe `scripts/build-deploy-bundle.mjs`.
   */
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Der Referrer darf keine Fahrt- oder Meldungs-IDs nach aussen tragen.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // Standort braucht die App selbst; Kamera/Mikrofon nie.
            value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // Der Service Worker darf NIE aus dem Cache kommen — sonst bleibt eine
        // kaputte Version dauerhaft aktiv.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
    ];
  },
};

export default nextConfig;
