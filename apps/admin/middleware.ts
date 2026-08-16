import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Zugriffsschutz und Sitzungsverwaltung (§33).
 *
 * Drei Aufgaben:
 *   1. Supabase-Sitzung erneuern (sonst laufen Tokens still ab)
 *   2. Nicht angemeldete Zugriffe auf /login umleiten
 *   3. Inaktivitäts-Timeout durchsetzen
 *
 * Die eigentliche Autorisierung (Rolle ADMIN/MODERATOR) passiert zusätzlich
 * serverseitig in der API — die Middleware ist nur die erste Hürde, nie die
 * einzige.
 */
const SESSION_TIMEOUT_MINUTES = Number(process.env.ADMIN_SESSION_TIMEOUT_MINUTES ?? '30');
const ACTIVITY_COOKIE = 'swissov_admin_last_activity';
const PUBLIC_PATHS = ['/login', '/auth/callback'];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Ohne Konfiguration bleibt nur die Login-Seite erreichbar, die den
  // fehlenden Zugang erklärt (§55).
  if (!supabaseUrl || !supabaseKey) {
    if (PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path))) return response;
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) => {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
          });
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user) {
    if (isPublic) return response;
    const redirect = new URL('/login', request.url);
    redirect.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(redirect);
  }

  // Inaktivitäts-Timeout: nach längerer Pause wird die Sitzung beendet.
  const lastActivity = Number(request.cookies.get(ACTIVITY_COOKIE)?.value ?? '0');
  const now = Date.now();
  if (lastActivity > 0 && now - lastActivity > SESSION_TIMEOUT_MINUTES * 60_000) {
    await supabase.auth.signOut();
    const redirect = NextResponse.redirect(new URL('/login?reason=timeout', request.url));
    redirect.cookies.delete(ACTIVITY_COOKIE);
    return redirect;
  }

  response.cookies.set(ACTIVITY_COOKIE, String(now), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TIMEOUT_MINUTES * 60,
  });

  return response;
}

export const config = {
  // Statische Assets und Bilder brauchen keine Sitzungsprüfung.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
