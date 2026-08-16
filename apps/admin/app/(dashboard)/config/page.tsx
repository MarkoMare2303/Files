import { revalidatePath } from 'next/cache';
import React from 'react';
import { AdminApiError, adminApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Laufzeitkonfiguration und Feature-Flags (§32/§62).
 *
 * Die Werte werden serverseitig gegen das Zod-Schema validiert; ungültige
 * Eingaben werden abgelehnt und nicht stillschweigend korrigiert.
 */
async function saveSection(formData: FormData): Promise<void> {
  'use server';
  const section = String(formData.get('__section')) as
    | 'detection'
    | 'rateLimits'
    | 'moderation'
    | 'trust';

  const body: Record<string, unknown> = {};
  const weights: Record<string, number> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('__')) continue;
    if (key.startsWith('weights.')) {
      weights[key.slice('weights.'.length)] = Number(value);
      continue;
    }
    body[key] = Number(value);
  }
  if (Object.keys(weights).length > 0) body.weights = weights;

  await adminApi.updateConfig(section, body);
  revalidatePath('/config');
}

async function toggleFlag(formData: FormData): Promise<void> {
  'use server';
  const key = String(formData.get('key'));
  const enabled = String(formData.get('enabled')) === 'true';
  const rollout = formData.get('rolloutPercentage');
  await adminApi.updateFeatureFlag(key, {
    enabled,
    ...(rollout ? { rolloutPercentage: Number(rollout) } : {}),
  });
  revalidatePath('/config');
}

export default async function ConfigPage(): Promise<React.JSX.Element> {
  let config;
  let flags;
  try {
    [config, flags] = await Promise.all([adminApi.config(), adminApi.featureFlags()]);
  } catch (error) {
    return (
      <>
        <h1>Konfiguration</h1>
        <div className="notice error">
          {error instanceof AdminApiError ? error.message : 'Unbekannter Fehler'}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Konfiguration</h1>
      <p className="subtitle">
        Änderungen wirken sofort auf alle Clients und werden im Audit-Log protokolliert.
      </p>

      <h2>Fahrtenerkennung</h2>
      <div className="card">
        <form action={saveSection} style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
          <input type="hidden" name="__section" value="detection" />
          <Field
            label="Automatisch übernehmen ab"
            name="autoThreshold"
            value={config.detection.autoThreshold}
            step={0.01}
            hint="Confidence 0–1. Vorgabe: 0.90"
          />
          <Field
            label="Bestätigung ab"
            name="confirmThreshold"
            value={config.detection.confirmThreshold}
            step={0.01}
            hint="Darunter werden mehrere Fahrten zur Auswahl angezeigt. Vorgabe: 0.70"
          />
          <Field
            label="Suchradius (m)"
            name="defaultRadiusMeters"
            value={config.detection.defaultRadiusMeters}
            step={50}
          />
          <Field label="Max. Kandidaten" name="maxCandidates" value={config.detection.maxCandidates} />

          <h3 style={{ margin: '8px 0 0', fontSize: 15 }}>Gewichte der Teilscores</h3>
          {Object.entries(config.detection.weights).map(([key, value]) => (
            <Field key={key} label={key} name={`weights.${key}`} value={value} step={0.05} />
          ))}
          <button type="submit" style={{ justifySelf: 'start' }}>
            Speichern
          </button>
        </form>
      </div>

      <h2>Rate Limits</h2>
      <div className="card">
        <form action={saveSection} style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
          <input type="hidden" name="__section" value="rateLimits" />
          {Object.entries(config.rateLimits).map(([key, value]) => (
            <Field key={key} label={key} name={key} value={value} />
          ))}
          <button type="submit" style={{ justifySelf: 'start' }}>
            Speichern
          </button>
        </form>
      </div>

      <h2>Moderationsregeln</h2>
      <div className="card">
        <form action={saveSection} style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
          <input type="hidden" name="__section" value="moderation" />
          {Object.entries(config.moderation).map(([key, value]) => (
            <Field key={key} label={key} name={key} value={value} step={0.05} />
          ))}
          <button type="submit" style={{ justifySelf: 'start' }}>
            Speichern
          </button>
        </form>
      </div>

      <h2>Trust Score</h2>
      <div className="card">
        <form action={saveSection} style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
          <input type="hidden" name="__section" value="trust" />
          {Object.entries(config.trust).map(([key, value]) => (
            <Field key={key} label={key} name={key} value={value} step={0.5} />
          ))}
          <button type="submit" style={{ justifySelf: 'start' }}>
            Speichern
          </button>
        </form>
      </div>

      <h2>Feature-Flags</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Schlüssel</th>
              <th>Beschreibung</th>
              <th>Rollout</th>
              <th>Status</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {flags.flags.map((flag) => (
              <tr key={flag.key}>
                <td>
                  <code>{flag.key}</code>
                </td>
                <td style={{ color: 'var(--color-text-secondary)' }}>{flag.description ?? '—'}</td>
                <td>{flag.rolloutPercentage} %</td>
                <td>
                  <span className={`badge ${flag.enabled ? 'ok' : 'danger'}`}>
                    {flag.enabled ? 'aktiv' : 'aus'}
                  </span>
                </td>
                <td>
                  <form action={toggleFlag} className="row">
                    <input type="hidden" name="key" value={flag.key} />
                    <input type="hidden" name="enabled" value={String(!flag.enabled)} />
                    <input
                      name="rolloutPercentage"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={flag.rolloutPercentage}
                      style={{ width: 90 }}
                    />
                    <button type="submit" className="secondary">
                      {flag.enabled ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Field({
  label,
  name,
  value,
  step = 1,
  hint,
}: {
  label: string;
  name: string;
  value: number;
  step?: number;
  hint?: string;
}): React.JSX.Element {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <input type="number" name={name} defaultValue={value} step={step} />
      {hint ? (
        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{hint}</span>
      ) : null}
    </label>
  );
}
