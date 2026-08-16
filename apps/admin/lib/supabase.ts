import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase-Client für Server Components und Server Actions (§33).
 *
 * Die Sitzung liegt in httpOnly-Cookies mit `sameSite=lax` und `secure` in
 * Produktion — kein Token im JavaScript-Zugriff.
 */
export const ADMIN_AUTH_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, {
                ...options,
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/',
              });
            }
          } catch {
            // In Server Components ist das Setzen von Cookies nicht erlaubt;
            // die Middleware erneuert die Sitzung stattdessen.
          }
        },
      },
    },
  );
}

export interface AdminSession {
  accessToken: string;
  userId: string;
  email: string | null;
  /** Authenticator Assurance Level: `aal2` bedeutet MFA erfüllt. */
  aal: string | null;
}

/** Liest die aktuelle Sitzung; `null`, wenn nicht angemeldet. */
export async function getAdminSession(): Promise<AdminSession | null> {
  if (!ADMIN_AUTH_CONFIGURED) return null;

  const supabase = await createSupabaseServerClient();
  // getUser() prüft das Token serverseitig gegen Supabase — getSession()
  // allein würde dem Cookie-Inhalt vertrauen.
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return null;

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  return {
    accessToken,
    userId: userData.user.id,
    email: userData.user.email ?? null,
    aal: aalData?.currentLevel ?? null,
  };
}
