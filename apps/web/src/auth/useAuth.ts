import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { useSessionStore } from '../state/session.store';
import { getSupabase, signOut as supabaseSignOut } from './supabase';

/**
 * Verbindet die Supabase-Sitzung mit dem App-Zustand.
 *
 * Das Zugriffstoken landet nur im Speicher (und im Secure Store des
 * Supabase-Clients) — nie in AsyncStorage der App (§42).
 */
export function useAuthBootstrap(): { ready: boolean } {
  const setAuth = useSessionStore((state) => state.setAuth);
  const setSettings = useSessionStore((state) => state.setSettings);
  const storeSignOut = useSessionStore((state) => state.signOut);
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      // Gastmodus: die App ist voll benutzbar, nur nicht zum Melden.
      setReady(true);
      return undefined;
    }

    let cancelled = false;

    const loadProfile = async (token: string | null): Promise<void> => {
      if (!token) {
        storeSignOut();
        return;
      }
      setAuth(token, null);
      try {
        const { profile, settings } = await api.me();
        if (cancelled) return;
        setAuth(token, profile);
        setSettings(settings);
      } catch {
        // Profil konnte nicht geladen werden — Token bleibt gesetzt, die App
        // arbeitet weiter und versucht es beim nächsten Aufruf erneut.
      }
    };

    void supabase.auth.getSession().then(({ data }) => {
      void loadProfile(data.session?.access_token ?? null).finally(() => {
        if (!cancelled) setReady(true);
      });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session?.access_token ?? null);
      // Nach Anmeldewechsel dürfen keine Daten des Vorgängers stehen bleiben.
      void queryClient.invalidateQueries();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [queryClient, setAuth, setSettings, storeSignOut]);

  return { ready };
}

export function useSignOut(): () => Promise<void> {
  const storeSignOut = useSessionStore((state) => state.signOut);
  const queryClient = useQueryClient();

  return async () => {
    await supabaseSignOut();
    storeSignOut();
    queryClient.clear();
  };
}

export function useIsSignedIn(): boolean {
  return useSessionStore((state) => state.accessToken !== null);
}
