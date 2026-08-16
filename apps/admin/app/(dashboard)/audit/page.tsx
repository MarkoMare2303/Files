import React from 'react';
import { AdminApiError, adminApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Audit-Log (§33) — append-only, nur für Administratoren lesbar. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const entityType = Array.isArray(params.entityType) ? params.entityType[0] : params.entityType;

  let data;
  try {
    data = await adminApi.auditLogs({ entityType, limit: 100, offset: 0 });
  } catch (error) {
    return (
      <>
        <h1>Audit-Log</h1>
        <div className="notice error">
          {error instanceof AdminApiError ? error.message : 'Unbekannter Fehler'}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Audit-Log</h1>
      <p className="subtitle">
        {data.total.toLocaleString('de-CH')} Einträge. Das Protokoll ist unveränderlich — Einträge
        können weder bearbeitet noch gelöscht werden.
      </p>

      <form className="filters" method="get">
        <select name="entityType" defaultValue={entityType ?? ''}>
          <option value="">Alle Objekttypen</option>
          <option value="report">Meldungen</option>
          <option value="profile">Nutzer</option>
          <option value="report_category">Kategorien</option>
          <option value="app_config">Konfiguration</option>
          <option value="feature_flag">Feature-Flags</option>
        </select>
        <button type="submit">Filtern</button>
      </form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Zeitpunkt</th>
              <th>Akteur</th>
              <th>Aktion</th>
              <th>Objekt</th>
              <th>Vorher → Nachher</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={5}>Keine Einträge.</td>
              </tr>
            ) : (
              data.items.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(entry.createdAt)}</td>
                  <td>{entry.actorAlias ?? entry.actorId ?? '—'}</td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {entry.entityType}
                    <div style={{ color: 'var(--color-text-tertiary)' }}>{entry.entityId ?? ''}</div>
                  </td>
                  <td>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        color: 'var(--color-text-secondary)',
                        maxWidth: 460,
                      }}
                    >
                      {truncate(JSON.stringify(entry.before))} → {truncate(JSON.stringify(entry.after))}
                    </pre>
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

function truncate(value: string | undefined, max = 160): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('de-CH', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Zurich',
  }).format(new Date(iso));
}
