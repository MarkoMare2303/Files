'use client';

import { useParams, useRouter } from 'next/navigation';
import React from 'react';
import { useDepartures } from '../../../../src/api/hooks';
import { SourceBadge, departureSource } from '../../../../src/components/SourceBadge';
import { Badge, Card, Text } from '../../../../src/components/primitives';
import { DataNotice, EmptyState, ErrorState, LoadingList } from '../../../../src/components/states';
import { t } from '../../../../src/i18n/index';
import { useStopReportsRealtime } from '../../../../src/realtime/useReportsRealtime';
import { useTheme } from '../../../../src/theme/ThemeProvider';

/**
 * Abfahrtstafel einer Haltestelle.
 *
 * Jede Zeile sagt, worauf ihre Zeit beruht: Echtzeit, Fahrplan oder Schätzung
 * (§7). Ohne Echtzeitdaten steht das als Hinweis über der Liste — nicht als
 * stille Halbwahrheit.
 */
export default function StopPage(): React.JSX.Element {
  const params = useParams<{ stopId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const stopId = typeof params.stopId === 'string' ? decodeURIComponent(params.stopId) : null;

  const query = useDepartures(stopId);
  useStopReportsRealtime(stopId);

  if (query.isLoading) return <LoadingList rows={5} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const departures = query.data?.departures ?? [];

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="title1" as="h1">
        {departures[0]?.stopName ?? stopId}
      </Text>

      {query.data && !query.data.realtimeAvailable ? (
        <DataNotice message={t('error.realtimeUnavailable')} />
      ) : null}

      {departures.length === 0 ? <EmptyState title={t('manual.noDepartures')} /> : null}

      <ul className="flex flex-col gap-sm">
        {departures.map((departure) => (
          <li key={`${departure.tripId}:${departure.serviceDate}:${departure.scheduledDeparture}`}>
            <Card
              onClick={() =>
                router.push(
                  `/trip/${encodeURIComponent(departure.tripId)}?serviceDate=${departure.serviceDate}`,
                )
              }
              ariaLabel={`${departure.routeShortName ?? departure.tripId} ${departure.headsign ?? ''}`}
            >
              <div className="flex items-center gap-md">
                <Text variant="mono" as="span" className="w-[56px] shrink-0">
                  {formatTime(departure.realtimeDeparture ?? departure.scheduledDeparture)}
                </Text>

                <div className="flex flex-1 flex-col gap-xxs">
                  <Text variant="bodyStrong" as="span">
                    {departure.routeShortName ?? departure.tripId}
                    {departure.headsign ? ` → ${departure.headsign}` : ''}
                  </Text>
                  <div className="flex flex-wrap items-center gap-xs">
                    {departure.platformCode ? (
                      <Text variant="footnote" color="textTertiary" as="span">
                        {departure.platformCode}
                      </Text>
                    ) : null}
                    {departure.cancelled ? (
                      <Badge
                        label={t('trip.cancelled')}
                        color={colors.danger}
                        background={colors.dangerSubtle}
                      />
                    ) : departure.delaySeconds && departure.delaySeconds >= 60 ? (
                      <Text variant="footnote" color="warning" as="span">
                        {t('trip.delay', { minutes: Math.round(departure.delaySeconds / 60) })}
                      </Text>
                    ) : departure.delaySeconds !== null ? (
                      <Text variant="footnote" color="success" as="span">
                        {t('trip.onTime')}
                      </Text>
                    ) : null}
                  </div>
                </div>

                <SourceBadge kind={departureSource(departure)} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Zeigt eine ISO-Zeit als HH:MM in der lokalen Zeitzone. */
function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}
