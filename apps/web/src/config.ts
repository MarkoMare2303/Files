/**
 * Laufzeitkonfiguration der PWA.
 *
 * Enthält ausschliesslich nicht-geheime Werte. Alles, was hier steht, ist im
 * ausgelieferten JavaScript lesbar. Serverseitige Schlüssel (Service Role,
 * opentransportdata.swiss, OJP, VAPID-Private-Key) sind dem Browser bewusst
 * unbekannt (§6/§42).
 *
 * Next.js ersetzt `process.env.NEXT_PUBLIC_*` zur Bauzeit durch Literale —
 * deshalb müssen die Zugriffe wörtlich ausgeschrieben sein und dürfen nicht
 * dynamisch zusammengesetzt werden.
 */
const rawApiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const config = {
  apiUrl: rawApiUrl.replace(/\/$/, ''),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  mapStyleUrl:
    process.env.NEXT_PUBLIC_MAP_TILE_URL ??
    'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json',
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
} as const;

/** Ohne Supabase-Zugang ist nur der Gastmodus möglich (§22). */
export const isAuthConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

/** Ohne Style-URL kann keine Karte gerendert werden — die App sagt das ehrlich (§55). */
export const isMapConfigured = config.mapStyleUrl.length > 0;

/** Startausschnitt der Karte: die gesamte Schweiz. */
export const SWITZERLAND_CENTER = { latitude: 46.8182, longitude: 8.2275 };
export const SWITZERLAND_DEFAULT_ZOOM = 7.2;
