import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Profile, TripSession, UserSettings } from '@swissov/types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { setTokenProvider } from '../api/client.js';
import type { Locale } from '../i18n/index.js';

/**
 * Globaler App-Zustand (§Tech-Stack: Zustand).
 *
 * Bewusst schmal gehalten: Serverdaten liegen in TanStack Query, hier steht
 * nur, was die App über sich selbst weiss.
 */
interface SessionState {
  accessToken: string | null;
  profile: Profile | null;
  settings: UserSettings | null;
  activeTrip: TripSession | null;

  onboardingCompleted: boolean;
  locationPermission: 'unknown' | 'granted' | 'denied' | 'later';
  locale: Locale;
  themePreference: 'SYSTEM' | 'LIGHT' | 'DARK';
  /** App-generierte Installations-ID (kein Hardware-Identifier, §21/§23). */
  installId: string | null;

  setAuth(token: string | null, profile: Profile | null): void;
  setSettings(settings: UserSettings | null): void;
  setActiveTrip(session: TripSession | null): void;
  completeOnboarding(): void;
  setLocationPermission(value: SessionState['locationPermission']): void;
  setLocale(locale: Locale): void;
  setThemePreference(value: SessionState['themePreference']): void;
  setInstallId(id: string): void;
  signOut(): void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      profile: null,
      settings: null,
      activeTrip: null,
      onboardingCompleted: false,
      locationPermission: 'unknown',
      locale: 'de',
      themePreference: 'SYSTEM',
      installId: null,

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
      setInstallId: (installId) => set({ installId }),
      signOut: () => set({ accessToken: null, profile: null, settings: null, activeTrip: null }),
    }),
    {
      name: 'swissov-session',
      storage: createJSONStorage(() => AsyncStorage),
      // Das Zugriffstoken wird NICHT persistiert — es liegt im Supabase-Client
      // (Secure Store) und wird beim Start neu geladen.
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
        locationPermission: state.locationPermission,
        locale: state.locale,
        themePreference: state.themePreference,
        installId: state.installId,
      }),
    },
  ),
);

// Der API-Client holt sich das Token bei jeder Anfrage frisch aus dem Store.
setTokenProvider(() => useSessionStore.getState().accessToken);
