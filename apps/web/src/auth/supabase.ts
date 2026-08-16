import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, isAuthConfigured } from '../config';

/**
 * Supabase-Client für Authentifizierung und Realtime (§22/§40).
 *
 * Verwendet ausschliesslich den öffentlichen Anon-Key. Der Service-Role-Key
 * ist dem Browser bewusst unbekannt und existiert nur serverseitig (§42).
 *
 * Unterschiede zur nativen Fassung:
 *   • `detectSessionInUrl: true` — der Magic-Link kehrt als URL-Fragment
 *     zurück und muss beim Aufruf von `/auth/callback` eingelöst werden.
 *   • Speicher ist `localStorage`. Ein Refresh-Token im Browser ist gegen XSS
 *     nicht so gut geschützt wie ein nativer Secure Store; die CSP und das
 *     Verbot von Fremdskripten sind deshalb Teil des Sicherheitskonzepts
 *     (siehe SECURITY_AUDIT.md, Finding WEB-004).
 *   • Ohne `window` (Server-Rendering, Tests) gibt es keinen Client.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isAuthConfigured) return null;
  if (typeof window === 'undefined') return null;
  if (client) return client;

  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: window.localStorage,
      storageKey: 'swissov-auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
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
 * Anmeldung über Apple oder Google.
 *
 * Im Browser gibt es kein natives Identity-Token — stattdessen leitet
 * Supabase zum Anbieter weiter und kehrt auf `/auth/callback` zurück.
 */
export async function signInWithProvider(
  provider: 'apple' | 'google',
  redirectTo: string,
): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: 'auth-not-configured' };

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}
