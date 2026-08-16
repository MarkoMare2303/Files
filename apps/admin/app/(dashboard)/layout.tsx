import { redirect } from 'next/navigation';
import Link from 'next/link';
import React from 'react';
import { adminApi, AdminApiError } from '@/lib/api';
import { getAdminSession } from '@/lib/supabase';

/**
 * Geschütztes Layout.
 *
 * Zwei Prüfungen vor jeder Seite (§33):
 *   1. MFA: ohne `aal2` kein Zugriff auf administrative Funktionen
 *   2. Rolle: die API antwortet mit 403, wenn das Konto weder MODERATOR
 *      noch ADMIN ist — das Portal zeigt dann eine klare Meldung statt
 *      einer leeren Seite.
 */
const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/reports', label: 'Meldungen' },
  { href: '/users', label: 'Nutzer' },
  { href: '/categories', label: 'Kategorien' },
  { href: '/config', label: 'Konfiguration' },
  { href: '/audit', label: 'Audit-Log' },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await getAdminSession();
  if (!session) redirect('/login');

  // MFA ist Pflicht — eine versteckte URL ist kein Schutz (§33).
  if (session.aal !== 'aal2') {
    return (
      <div className="login-shell">
        <div className="card login-card">
          <h1>Zwei-Faktor-Authentifizierung erforderlich</h1>
          <p className="subtitle">
            Administrative Funktionen setzen einen zweiten Faktor voraus. Richte in deinem Konto
            eine Authenticator-App ein und melde dich erneut an.
          </p>
          <Link className="button" href="/login">
            Zur Anmeldung
          </Link>
        </div>
      </div>
    );
  }

  // Rollenprüfung über die API — nie clientseitig.
  try {
    await adminApi.dashboard();
  } catch (error) {
    if (error instanceof AdminApiError && (error.status === 403 || error.status === 401)) {
      return (
        <div className="login-shell">
          <div className="card login-card">
            <h1>Kein Zugriff</h1>
            <p className="subtitle">
              Dieses Konto ({session.email ?? session.userId}) hat keine Moderations- oder
              Administrationsrechte.
            </p>
          </div>
        </div>
      );
    }
    // Andere Fehler (z. B. API nicht erreichbar) werden auf den Seiten selbst
    // angezeigt — das Layout blockiert deshalb nicht.
  }

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Hauptnavigation">
        <div className="brand">ÖV Live</div>
        {NAV.map((item) => (
          <Link key={item.href} className="nav-link" href={item.href}>
            {item.label}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {session.email ?? session.userId}
        </div>
        <form action="/auth/signout" method="post">
          <button className="secondary" type="submit" style={{ width: '100%', marginTop: 8 }}>
            Abmelden
          </button>
        </form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
