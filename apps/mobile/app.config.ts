import type { ExpoConfig } from 'expo/config';

/**
 * Expo-Konfiguration.
 *
 * WICHTIG: In `extra`/`EXPO_PUBLIC_*` landen ausschliesslich nicht-geheime
 * Werte — alles hier ist im App-Bundle lesbar (§23/§42).
 *
 * MapLibre ist ein natives Modul: die App läuft NICHT in Expo Go, sondern
 * benötigt einen Development Build (`expo prebuild && expo run:ios|android`)
 * bzw. einen EAS-Build. Siehe README.
 */
const config: ExpoConfig = {
  name: 'ÖV Live',
  slug: 'swissov-live',
  scheme: 'swissovlive',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  assetBundlePatterns: ['**/*'],

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'ch.swissovlive.app',
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Die Texte erscheinen im System-Dialog. Sie erklären konkret, wofür der
      // Standort gebraucht wird (§59) — keine generische Floskel.
      NSLocationWhenInUseUsageDescription:
        'Mit deinem Standort erkennen wir, mit welcher Verbindung du gerade unterwegs bist, und zeigen dir passende Meldungen.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Nur wenn du es aktivierst: Wir erkennen deine Fahrt auch, wenn die App im Hintergrund ist. Du kannst das jederzeit ausschalten.',
      UIBackgroundModes: ['location', 'remote-notification'],
    },
  },

  android: {
    package: 'ch.swissovlive.app',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#0D2E4A' },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'POST_NOTIFICATIONS',
      'VIBRATE',
    ],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Mit deinem Standort erkennen wir, mit welcher Verbindung du gerade unterwegs bist.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-notifications',
      { color: '#1E6BAA', defaultChannel: 'reports' },
    ],
  ],

  experiments: { typedRoutes: true },

  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    mapStyleUrl:
      process.env.EXPO_PUBLIC_MAP_TILE_URL ??
      'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json',
  },
};

export default config;
