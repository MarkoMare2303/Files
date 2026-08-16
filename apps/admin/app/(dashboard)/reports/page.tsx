import { revalidatePath } from 'next/cache';
import React from 'react';
import { AdminApiError, adminApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Moderations-Ansicht (§32).
 *
 * Filter nach Datum, Kategorie, Betreiber, Linie, Nutzer, Status und Trust
 * Score. Aktionen laufen als Server Actions über die API — dadurch ist die
 * Autorisierung serverseitig und jede Änderung landet im Audit-Log.
 */
async function moderate(formData: FormData): Promise<void> {
  'use server';
  const reportId = String(formData.get('reportId'));
  const action = String(formData.get('action')) as 'APPROVE' | 'REMOVE' | 'RESTORE';
  const reason = String(formData.get('reason') || '').trim();
  if (!reportId || reason.length < 3) return;
  await adminApi.moderateReport(reportId, action, reason);
  revalidatePath('/reports');
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const query = {
    status: single('status'),
    categoryKey: single('categoryKey'),
    routeId: single('routeId'),
    agencyId: single('agencyId'),
    q: single('q'),
    flaggedOnly: single('flaggedOnly'),
    minConfidence: single('minConfidence'),
    limit: 50,
    offset: Number(single('offset') ?? 0),
  };

  let data;
  try {
    data = await adminApi.reports(query);
  } catch (error) {
    return (
      <>
        <h1>Meldungen</h1>
        <div className="notice error">
          {error instanceof AdminApiError ? error.message : 'Unbekannter Fehler'}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Meldungen</h1>
      <p className="subtitle">{data.total.toLocaleString('de-CH')} Treffer</p>

      <form className="filters" method="get">
        <input name="q" placeholder="Text oder Trip-ID" defaultValue={query.q ?? ''} />
        <select name="status" defaultValue={query.status ?? ''}>
          <option value="">Alle Status</option>
          <option value="ACTIVE">Aktiv</option>
          <option value="PENDING_REVIEW">In Prüfung</option>
          <option value="REMOVED">Entfernt</option>
          <option value="EXPIRED">Abgelaufen</option>
          <option value="SHADOWED">Shadow</option>
        </select>
        <input name="categoryKey" placeholder="Kategorie-Schlüssel" defaultValue={query.categoryKey ?? ''} />
        <input name="routeId" placeholder="Linie" defaultValue={query.routeId ?? ''} />
        <select name="flaggedOnly" defaultValue={query.flaggedOnly ?? ''}>
          <option value="">Alle</option>
          <option value="true">Nur gemeldete</option>
        </select>
        <input
          name="minConfidence"
          type="number"
          min={0}
          max={100}
          placeholder="Trust ≥"
          defaultValue={query.minConfidence ?? ''}
          style={{ width: 110 }}
        />
        <button type="submit">Filtern</button>
      </form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Erstellt</th>
              <th>Kategorie</th>
              <th>Bezug</th>
              <th>Trust</th>
              <th>Stimmen</th>
              <th>Nutzer</th>
              <th>Status</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={8}>Keine Meldungen gefunden.</td>
              </tr>
            ) : (
              data.items.map((report) => (
                <tr key={report.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(report.createdAt)}</td>
                  <td>
                    <strong>{report.categoryKey}</strong>
                    {report.message ? (
                      <div style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
                        {report.message}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {report.routeShortName ?? report.routeId ?? '—'}
                    <br />
                    {report.stopName ?? report.stopId ?? ''}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        report.confidence >= 70 ? 'ok' : report.confidence >= 31 ? 'warn' : 'danger'
                      }`}
                    >
                      {report.confidence}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    +{report.upvotes} / −{report.downvotes}
                    {report.flagsCount > 0 ? (
                      <div>
                        <span className="badge danger">{report.flagsCount} gemeldet</span>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <a href={`/users?q=${encodeURIComponent(report.userAlias)}`}>{report.userAlias}</a>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                      Rep. {report.userReputation}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        report.status === 'ACTIVE'
                          ? 'ok'
                          : report.status === 'REMOVED'
                            ? 'danger'
                            : 'warn'
                      }`}
                    >
                      {report.status}
                    </span>
                  </td>
                  <td>
                    <form action={moderate} style={{ display: 'grid', gap: 6, minWidth: 190 }}>
                      <input type="hidden" name="reportId" value={report.id} />
                      <input name="reason" placeholder="Begründung (Pflicht)" required minLength={3} />
                      <div className="row">
                        <button type="submit" name="action" value="APPROVE" className="secondary">
                          Freigeben
                        </button>
                        <button type="submit" name="action" value="REMOVE" className="danger">
                          Entfernen
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
  return new Intl.DateTimeFormat('de-CH', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Zurich',
  }).format(new Date(iso));
}
