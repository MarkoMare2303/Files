import type { Profile, TripSession, UserSettings } from '@swissov/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { setInstallId, setTokenProvider } from '../api/client';
import type { Locale } from '../i18n/index';

/**
 * Globaler App-Zustand.
 *
 * Bewusst schmal gehalten: Serverdaten liegen in TanStack Query, hier steht
 * nur, was die App über sich selbst weiss.
 *
 * Persistiert wird in `localStorage` — synchron und klein genug für
 * Präferenzen. Die Offline-Warteschlange liegt bewusst NICHT hier, sondern in
 * IndexedDB (siehe `offline-queue.store.ts`).
 */
export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'later';

interface SessionState {
  accessToken: string | null;
  profile: Profile | null;
  settings: UserSettings | null;
  activeTrip: TripSession | null;

  onboardingCompleted: boolean;
  locationPermission: LocationPermission;
  locale: Locale;
  themePreference: 'SYSTEM' | 'LIGHT' | 'DARK';
  /** App-generierte Installations-ID (kein Geräte-Fingerprint, §21/§23). */
  installId: string | null;
  /** Wann zuletzt zur Installation eingeladen wurde — verhindert Nerven (§PWA). */
  installPromptDismissedAt: number | null;

  setAuth(token: string | null, profile: Profile | null): void;
  setSettings(settings: UserSettings | null): void;
  setActiveTrip(session: TripSession | null): void;
  completeOnboarding(): void;
  setLocationPermission(value: LocationPermission): void;
  setLocale(locale: Locale): void;
  setThemePreference(value: SessionState['themePreference']): void;
  ensureInstallId(): string;
  dismissInstallPrompt(now?: number): void;
  signOut(): void;
}

/** RFC-4122-taugliche ID, auch ohne `crypto.randomUUID` (ältere iOS-Safari). */
export function generateId(): string {
  const cryptoRef = typeof globalThis === 'undefined' ? undefined : globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);

  // Version 4 und Variante nach RFC 4122 setzen.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      profile: null,
      settings: null,
      activeTrip: null,
      onboardingCompleted: false,
      locationPermission: 'unknown',
      locale: 'de',
      themePreference: 'SYSTEM',
      installId: null,
      installPromptDismissedAt: null,

      setAuth: (accessToken, profile) => set({ accessToken, profile }),
      setSettings: (settings) =>
        set((state) => ({
          settings,
          locale: settings?.locale ?? state.locale,
          themePreference: settings?.theme ?? state.themePreference,
        })),
      setActiveTrip: (activeTrip) => set({ activeTrip }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      setLocationPermission: (locationPermission) => set({ locationPermission }),
      setLocale: (locale) => set({ locale }),
      setThemePreference: (themePreference) => set({ themePreference }),

      ensureInstallId: () => {
        const existing = get().installId;
        if (existing) return existing;
        const created = generateId();
        set({ installId: created });
        return created;
      },

      dismissInstallPrompt: (now = Date.now()) => set({ installPromptDismissedAt: now }),

      signOut: () => set({ accessToken: null, profile: null, settings: null, activeTrip: null }),
    }),
    {
      name: 'swissov-session',
      storage: createJSONStorage(() =>
        typeof window === 'undefined'
          ? // Server-Rendering: kein Speicher, aber auch kein Absturz.
            { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
          : window.localStorage,
      ),
      // Das Zugriffstoken wird NICHT persistiert — es liegt im Supabase-Client
      // und wird beim Start neu geladen (§42).
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
        locationPermission: state.locationPermission,
        locale: state.locale,
        themePreference: state.themePreference,
        installId: state.installId,
        installPromptDismissedAt: state.installPromptDismissedAt,
      }),
      onRehydrateStorage: () => (state) => {
        // Nach dem Laden steht die Installations-ID für Kopfzeilen bereit.
        if (state?.installId) setInstallId(state.installId);
      },
    },
  ),
);

// Der API-Client holt sich das Token bei jeder Anfrage frisch aus dem Store.
setTokenProvider(() => useSessionStore.getState().accessToken);
