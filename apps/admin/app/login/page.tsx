import { redirect } from 'next/navigation';
import React from 'react';
import { ADMIN_AUTH_CONFIGURED, createSupabaseServerClient, getAdminSession } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Anmeldung am Admin-Portal (§33).
 *
 * Ablauf: E-Mail + Passwort → falls MFA eingerichtet, zweiter Faktor.
 * Ohne `aal2` verweigert das Dashboard-Layout den Zugriff.
 */
async function signIn(formData: FormData): Promise<void> {
  'use server';
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  if (!email || !password) redirect('/login?error=missing');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect('/login?error=invalid');
  redirect('/');
}

async function verifyMfa(formData: FormData): Promise<void> {
  'use server';
  const code = String(formData.get('code') || '').trim();
  const supabase = await createSupabaseServerClient();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect('/login?error=no-factor');

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError || !challenge) redirect('/login?error=challenge');

  const { error } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  });
  if (error) redirect('/login?error=mfa');
  redirect('/');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;

  if (!ADMIN_AUTH_CONFIGURED) {
    return (
      <div className="login-shell">
        <div className="card login-card">
          <h1>Anmeldung nicht konfiguriert</h1>
          <p className="subtitle">
            Es fehlen <code>NEXT_PUBLIC_SUPABASE_URL</code> und{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Ohne diese Werte kann sich niemand am
            Admin-Portal anmelden. Siehe <code>.env.example</code> und README.
          </p>
        </div>
      </div>
    );
  }

  const session = await getAdminSession();
  const needsMfa = session !== null && session.aal !== 'aal2';

  return (
    <div className="login-shell">
      <div className="card login-card">
        <h1>ÖV Live Administration</h1>
        <p className="subtitle">
          {needsMfa
            ? 'Bitte gib den Code aus deiner Authenticator-App ein.'
            : 'Zugang nur für Moderation und Administration.'}
        </p>

        {reason === 'timeout' ? (
          <div className="notice">Die Sitzung wurde wegen Inaktivität beendet.</div>
        ) : null}
        {errorCode ? (
          <div className="notice error">
            {errorCode === 'invalid'
              ? 'E-Mail oder Passwort stimmen nicht.'
              : errorCode === 'mfa'
                ? 'Der Code war nicht korrekt.'
                : errorCode === 'no-factor'
                  ? 'Für dieses Konto ist keine Zwei-Faktor-Authentifizierung eingerichtet. Sie ist für den Admin-Zugang zwingend.'
                  : 'Anmeldung fehlgeschlagen.'}
          </div>
        ) : null}

        {needsMfa ? (
          <form action={verifyMfa} style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Bestätigungscode</span>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
              />
            </label>
            <button type="submit">Bestätigen</button>
          </form>
        ) : (
          <form action={signIn} style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>E-Mail</span>
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Passwort</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit">Anmelden</button>
          </form>
        )}
      </div>
    </div>
  );
}
