import { revalidatePath } from 'next/cache';
import React from 'react';
import { AdminApiError, adminApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Nutzerverwaltung (§32): Status, Meldungen, Reputation, Moderationshistorie. */
async function moderateUser(formData: FormData): Promise<void> {
  'use server';
  const userId = String(formData.get('userId'));
  const action = String(formData.get('action')) as 'WARN' | 'SHADOW_FLAG' | 'SUSPEND' | 'REINSTATE';
  const reason = String(formData.get('reason') || '').trim();
  const durationRaw = formData.get('durationHours');
  const durationHours = durationRaw ? Number(durationRaw) : undefined;
  if (!userId || reason.length < 3) return;
  await adminApi.moderateUser(userId, action, reason, durationHours);
  revalidatePath('/users');
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;

  let data;
  try {
    data = await adminApi.users({ q, status, limit: 50, offset: 0 });
  } catch (error) {
    return (
      <>
        <h1>Nutzer</h1>
        <div className="notice error">
          {error instanceof AdminApiError ? error.message : 'Unbekannter Fehler'}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Nutzer</h1>
      <p className="subtitle">
        {data.total.toLocaleString('de-CH')} Konten. Es werden ausschliesslich Pseudonyme
        angezeigt — keine E-Mail-Adressen.
      </p>

      <form className="filters" method="get">
        <input name="q" placeholder="Pseudonym" defaultValue={q ?? ''} />
        <select name="status" defaultValue={status ?? ''}>
          <option value="">Alle</option>
          <option value="ACTIVE">Aktiv</option>
          <option value="SHADOW_FLAGGED">Shadow-Flag</option>
          <option value="SUSPENDED">Gesperrt</option>
        </select>
        <button type="submit">Filtern</button>
      </form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Pseudonym</th>
              <th>Rolle</th>
              <th>Status</th>
              <th>Reputation</th>
              <th>Meldungen</th>
              <th>Entfernt</th>
              <th>Gemeldet</th>
              <th>Registriert</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={9}>Keine Konten gefunden.</td>
              </tr>
            ) : (
              data.items.map((user) => (
                <tr key={user.id}>
                  <td>{user.alias}</td>
                  <td>{user.role}</td>
                  <td>
                    <span
                      className={`badge ${
                        user.status === 'ACTIVE'
                          ? 'ok'
                          : user.status === 'SUSPENDED'
                            ? 'danger'
                            : 'warn'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td>{user.reputationScore}</td>
                  <td>{user.reportsCount}</td>
                  <td>{user.removedReportsCount}</td>
                  <td>{user.flagsReceived}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(user.createdAt)}</td>
                  <td>
                    <form action={moderateUser} style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input name="reason" placeholder="Begründung (Pflicht)" required minLength={3} />
                      <input
                        name="durationHours"
                        type="number"
                        min={1}
                        placeholder="Sperre in Stunden (optional)"
                      />
                      <div className="row" style={{ flexWrap: 'wrap' }}>
                        <button type="submit" name="action" value="WARN" className="secondary">
                          Verwarnen
                        </button>
                        <button type="submit" name="action" value="SHADOW_FLAG" className="secondary">
                          Shadow
                        </button>
                        <button type="submit" name="action" value="SUSPEND" className="danger">
                          Sperren
                        </button>
                        <button type="submit" name="action" value="REINSTATE" className="secondary">
                          Entsperren
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('de-CH', { dateStyle: 'short', timeZone: 'Europe/Zurich' }).format(
    new Date(iso),
  );
}
