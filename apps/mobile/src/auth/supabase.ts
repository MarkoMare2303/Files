import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, isAuthConfigured } from '../config.js';

/**
 * Supabase-Client für Authentifizierung und Realtime (§22/§40).
 *
 * Verwendet ausschliesslich den öffentlichen Anon-Key. Der Service-Role-Key
 * ist der App bewusst unbekannt und existiert nur serverseitig (§42).
 *
 * Ohne konfigurierte Werte gibt es keinen Client — die App bleibt im
 * Gastmodus nutzbar und sagt das im Anmeldebildschirm klar (§55).
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isAuthConfigured) return null;
  if (client) return client;

  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // In nativen Apps gibt es keine URL-Session-Erkennung.
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  });
  return client;
}

export interface AuthResult {
  ok: boolean;
  message?: string;
}

/** Anmeldung per E-Mail-Link (Magic Link). */
export async function signInWithEmail(email: string, redirectTo: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: 'auth-not-configured' };

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

/**
 * Anmeldung mit einem Identity-Token von Apple oder Google.
 *
 * Das Token wird vom jeweiligen nativen SDK geliefert und hier lediglich an
 * Supabase weitergereicht — die App prüft es nicht selbst.
 */
export async function signInWithIdToken(
  provider: 'apple' | 'google',
  idToken: string,
  nonce?: string,
): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: 'auth-not-configured' };

  const { error } = await supabase.auth.signInWithIdToken({
    provider,
    token: idToken,
    ...(nonce ? { nonce } : {}),
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}
