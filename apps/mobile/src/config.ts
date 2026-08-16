import Constants from 'expo-constants';

/**
 * Laufzeitkonfiguration der App.
 *
 * Enthält ausschliesslich nicht-geheime Werte. Serverseitige Schlüssel
 * (Service Role, opentransportdata.swiss, OJP) sind der App bewusst
 * unbekannt (§6/§42).
 */
interface Extra {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  mapStyleUrl: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

export const config = {
  apiUrl: (extra.apiUrl ?? 'http://localhost:3001').replace(/\/$/, ''),
  supabaseUrl: extra.supabaseUrl ?? '',
  supabaseAnonKey: extra.supabaseAnonKey ?? '',
  mapStyleUrl: extra.mapStyleUrl ?? '',
} as const;

/** Ohne Supabase-Zugang ist nur der Gastmodus möglich (§22). */
export const isAuthConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

/** Ohne Style-URL kann keine Karte gerendert werden — die App sagt das ehrlich (§55). */
export const isMapConfigured = config.mapStyleUrl.length > 0;

/** Startausschnitt der Karte: die gesamte Schweiz. */
export const SWITZERLAND_CENTER = { latitude: 46.8182, longitude: 8.2275 };
export const SWITZERLAND_DEFAULT_ZOOM = 7.2;
