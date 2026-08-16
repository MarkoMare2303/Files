'use client';

import type { ReportCategory } from '@swissov/types';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { ApiError } from '../../../src/api/client';
import { api } from '../../../src/api/endpoints';
import { useAppConfig } from '../../../src/api/hooks';
import { Button, Card, Text, cx } from '../../../src/components/primitives';
import { DataNotice, ErrorState, LoadingList } from '../../../src/components/states';
import { pick, t } from '../../../src/i18n/index';
import { useLocation } from '../../../src/location/useLocation';
import { useOfflineQueue } from '../../../src/state/offline-queue.store';
import { generateId, useSessionStore } from '../../../src/state/session.store';

/**
 * Melden (§15/§69).
 *
 * Ziel: unter fünf Sekunden von „App offen" zu „Meldung gesendet". Deshalb
 * ein Griff — Kategorie antippen, fertig. Der Freitext ist optional und
 * kommt erst nach der Auswahl.
 *
 * Der gesamte Kontext (Fahrt, Linie, Halt) wird serverseitig aus der aktiven
 * Fahrt-Sitzung abgeleitet; die App schickt nur Kategorie und Position.
 */
function vibrate(pattern: number | number[]): void {
  // Nicht jeder Browser kann das — vor allem iOS-Safari nicht. Ohne
  // Vibration bleibt die visuelle Rückmeldung, kein Fehler.
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

export default function ReportPage(): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();

  const configQuery = useAppConfig();
  const activeTrip = useSessionStore((state) => state.activeTrip);
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const { latest } = useLocation();
  const enqueue = useOfflineQueue((state) => state.enqueue);

  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'queued'>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const maxLength = configQuery.data?.limits.messageMaxLength ?? 280;

  const grouped = useMemo(() => {
    const groups = new Map<string, ReportCategory[]>();
    for (const category of configQuery.data?.categories ?? []) {
      // Kategorien, die zwingend eine Fahrt brauchen, ohne aktive Fahrt
      // ausblenden — sie wären ohnehin nicht absendbar (§55).
      if (category.requiresTrip && !activeTrip) continue;
      const list = groups.get(category.group) ?? [];
      list.push(category);
      groups.set(category.group, list);
    }
    return [...groups.entries()];
  }, [configQuery.data, activeTrip]);

  async function submit(category: ReportCategory): Promise<void> {
    if (!signedIn) {
      router.push('/login');
      return;
    }

    setStatus('sending');
    setPending(category.key);
    setError(null);
    vibrate(15);

    const clientReportId = generateId();
    const input = {
      categoryKey: category.key,
      ...(activeTrip ? { tripSessionId: activeTrip.id } : {}),
      ...(latest
        ? { lat: latest.lat, lon: latest.lon, accuracy: latest.accuracy, speed: latest.speed }
        : {}),
      ...(message.trim().length > 0 ? { message: message.trim() } : {}),
      clientReportId,
      observedAt: new Date().toISOString(),
    };

    try {
      await api.createReport(input);
      setStatus('sent');
      setMessage('');
      vibrate([12, 40, 12]);
      await queryClient.invalidateQueries({ queryKey: ['trip-reports'] });
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.isOffline) {
        // Funkloch: lokal einreihen und später senden (§39).
        enqueue(input, clientReportId);
        setStatus('queued');
        setMessage('');
        return;
      }
      setStatus('idle');
      setError(submitError);
    } finally {
      setPending(null);
    }
  }

  if (configQuery.isLoading) return <LoadingList rows={4} />;
  if (configQuery.isError) {
    return <ErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="title1" as="h1">
        {t('report.createTitle')}
      </Text>

      {!signedIn ? <DataNotice message={t('report.needsAccount')} /> : null}

      {status === 'sent' ? (
        <div role="status" data-testid="report-success" className="rounded-md bg-success-subtle p-md">
          <Text variant="callout" color="success">
            {t('report.success')}
          </Text>
        </div>
      ) : null}

      {status === 'queued' ? (
        <div role="status" data-testid="report-queued" className="rounded-md bg-warning-subtle p-md">
          <Text variant="callout" color="warning">
            {t('report.successOffline')}
          </Text>
        </div>
      ) : null}

      {error ? <ErrorState error={error} /> : null}

      {grouped.map(([group, items]) => (
        <section key={group} className="flex flex-col gap-sm">
          <Text variant="title3" as="h2" color="textSecondary">
            {group}
          </Text>
          <div className="grid grid-cols-2 gap-md">
            {items.map((category) => (
              <button
                key={category.key}
                type="button"
                data-testid={`category-${category.key}`}
                disabled={status === 'sending'}
                onClick={() => void submit(category)}
                className={cx(
                  'flex min-h-[88px] flex-col items-start justify-between gap-sm rounded-lg border p-md text-left',
                  'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  pending === category.key
                    ? 'border-brand bg-brand-subtle'
                    : 'border-border bg-surface hover:bg-surface-sunken',
                )}
              >
                <span
                  aria-hidden="true"
                  className="block h-3 w-3 rounded-pill"
                  style={{ backgroundColor: category.color }}
                />
                <Text variant="callout" as="span">
                  {pick(category.label)}
                </Text>
              </button>
            ))}
          </div>
        </section>
      ))}

      <Card>
        <label className="flex flex-col gap-sm">
          <Text variant="footnote" color="textSecondary" as="span">
            {t('report.optionalMessage')}
          </Text>
          <textarea
            value={message}
            maxLength={maxLength}
            rows={3}
            placeholder={t('report.messagePlaceholder')}
            onChange={(event) => setMessage(event.target.value)}
            className="w-full resize-y rounded-md border border-border bg-surface p-md text-[16px] leading-[23px] text-text-primary placeholder:text-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
          <Text variant="caption" color="textTertiary" as="span">
            {message.length} / {maxLength}
          </Text>
        </label>
      </Card>

      {activeTrip ? null : (
        <Button
          label={t('detection.manualButton')}
          variant="secondary"
          onClick={() => router.push('/trips')}
        />
      )}
    </div>
  );
}
