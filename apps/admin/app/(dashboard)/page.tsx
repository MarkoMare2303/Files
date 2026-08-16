import React from 'react';
import { AdminApiError, adminApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Dashboard (§32): Nutzer, Meldungen, Spamquote, Moderationsfälle,
 * GTFS-Importstatus und Zustand der Datenquellen.
 */
export default async function DashboardPage(): Promise<React.JSX.Element> {
  let data;
  try {
    data = await adminApi.dashboard();
  } catch (error) {
    const message = error instanceof AdminApiError ? error.message : 'Unbekannter Fehler';
    return (
      <>
        <h1>Dashboard</h1>
        <div className="notice error">Daten konnten nicht geladen werden: {message}</div>
      </>
    );
  }

  return (
    <>
      <h1>Dashboard</h1>
      <p className="subtitle">Überblick über Community, Moderation und Datenquellen.</p>

      <h2>Nutzer</h2>
      <div className="grid">
        <Stat label="Konten gesamt" value={data.users.total} />
        <Stat label="Aktiv (7 Tage)" value={data.users.activeLast7Days} />
        <Stat label="Neu (7 Tage)" value={data.users.newLast7Days} />
        <Stat label="Gesperrt" value={data.users.suspended} tone={data.users.suspended > 0 ? 'warn' : undefined} />
        <Stat label="Shadow-Flag" value={data.users.shadowFlagged} />
      </div>

      <h2>Meldungen</h2>
      <div className="grid">
        <Stat label="Heute" value={data.reports.today} />
        <Stat label="Aktiv" value={data.reports.active} />
        <Stat label="7 Tage" value={data.reports.last7Days} />
        <Stat
          label="Moderation offen"
          value={data.reports.pendingModeration}
          tone={data.reports.pendingModeration > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Spamquote"
          value={`${data.reports.spamRatePercent} %`}
          tone={data.reports.spamRatePercent > 10 ? 'danger' : 'ok'}
        />
      </div>

      <h2>Meldungen pro Kategorie (7 Tage)</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Kategorie</th>
              <th style={{ width: 120 }}>Anzahl</th>
            </tr>
          </thead>
          <tbody>
            {data.reports.byCategory.slice(0, 15).map((row) => (
              <tr key={row.categoryKey}>
                <td>{row.label.de}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Fahrplandaten</h2>
      <div className="card">
        {data.transit.activeImport ? (
          <table>
            <tbody>
              <tr>
                <td>Feed-Version</td>
                <td>{data.transit.activeImport.feedVersion ?? '—'}</td>
              </tr>
              <tr>
                <td>Aktiviert</td>
                <td>{formatDate(data.transit.activeImport.activatedAt)}</td>
              </tr>
              <tr>
                <td>Haltestellen</td>
                <td>{data.transit.activeImport.stops.toLocaleString('de-CH')}</td>
              </tr>
              <tr>
                <td>Linien</td>
                <td>{data.transit.activeImport.routes.toLocaleString('de-CH')}</td>
              </tr>
              <tr>
                <td>Fahrten</td>
                <td>{data.transit.activeImport.trips.toLocaleString('de-CH')}</td>
              </tr>
              <tr>
                <td>Halte (stop_times)</td>
                <td>{data.transit.activeImport.stopTimes.toLocaleString('de-CH')}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="notice">
            Keine aktive Fahrplanversion. Import starten mit <code>pnpm gtfs:import</code>.
          </div>
        )}
        {data.transit.lastImportError ? (
          <div className="notice error" style={{ marginTop: 16 }}>
            Letzter Import: {data.transit.lastImportError}
          </div>
        ) : null}
      </div>

      <h2>Datenquellen</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Komponente</th>
              <th>Status</th>
              <th>Letzter Erfolg</th>
              <th>Meldung</th>
            </tr>
          </thead>
          <tbody>
            {data.health.length === 0 ? (
              <tr>
                <td colSpan={4}>Noch keine Statusmeldungen. Läuft der Worker?</td>
              </tr>
            ) : (
              data.health.map((component) => (
                <tr key={component.component}>
                  <td>{component.component}</td>
                  <td>
                    <span
                      className={`badge ${
                        component.status === 'OK' ? 'ok' : component.status === 'DEGRADED' ? 'warn' : 'danger'
                      }`}
                    >
                      {component.status}
                    </span>
                  </td>
                  <td>{formatDate(component.lastSuccessAt)}</td>
                  <td style={{ color: 'var(--color-text-secondary)' }}>{component.message ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'ok' | 'warn' | 'danger';
}): React.JSX.Element {
  const color =
    tone === 'danger'
      ? 'var(--color-danger)'
      : tone === 'warn'
        ? 'var(--color-warning)'
        : tone === 'ok'
          ? 'var(--color-success)'
          : 'var(--color-text-primary)';
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>
        {typeof value === 'number' ? value.toLocaleString('de-CH') : value}
      </div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('de-CH', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Zurich',
  }).format(new Date(iso));
}
