'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import React, { useState } from 'react';
import { api } from '../../../../src/api/endpoints';
import { useTrip, useTripReports, useVoteReport } from '../../../../src/api/hooks';
import { FeedItemCard } from '../../../../src/components/ReportCard';
import { SourceBadge } from '../../../../src/components/SourceBadge';
import { Badge, Button, Card, Text } from '../../../../src/components/primitives';
import { DataNotice, EmptyState, ErrorState, LoadingList } from '../../../../src/components/states';
import { t } from '../../../../src/i18n/index';
import { useTripReportsRealtime } from '../../../../src/realtime/useReportsRealtime';
import { useSessionStore } from '../../../../src/state/session.store';
import { useTheme } from '../../../../src/theme/ThemeProvider';

/**
 * Fahrtdetail (§13/§14) — zugleich Ziel eines Push-Deep-Links.
 *
 * Die Halteliste zeigt für jeden Halt an, ob die Zeit aus Echtzeitdaten
 * stammt oder dem Fahrplan entnommen ist. Die Meldungen darunter sind
 * konsequent als Community gekennzeichnet.
 */
export default function TripPage(): React.JSX.Element {
  const params = useParams<{ tripId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { colors } = useTheme();

  const tripId = typeof params.tripId === 'string' ? decodeURIComponent(params.tripId) : null;
  const serviceDate = searchParams.get('serviceDate') ?? undefined;

  const tripQuery = useTrip(tripId, serviceDate);
  const reportsQuery = useTripReports(tripId, serviceDate);
  const vote = useVoteReport(tripId ?? undefined, serviceDate);
  useTripReportsRealtime(tripId, serviceDate ?? null);

  const activeTrip = useSessionStore((state) => state.activeTrip);
  const setActiveTrip = useSessionStore((state) => state.setActiveTrip);
  const [busy, setBusy] = useState(false);

  const isActive = activeTrip?.tripId === tripId;

  async function toggleFollow(): Promise<void> {
    if (!activeTrip) return;
    setBusy(true);
    try {
      const result = await api.followSession(activeTrip.id, !activeTrip.following);
      setActiveTrip(result.session);
    } finally {
      setBusy(false);
    }
  }

  async function endSession(): Promise<void> {
    if (!activeTrip) return;
    setBusy(true);
    try {
      await api.endSession(activeTrip.id);
      setActiveTrip(null);
      router.push('/trips');
    } finally {
      setBusy(false);
    }
  }

  if (tripQuery.isLoading) return <LoadingList rows={5} />;
  if (tripQuery.isError) {
    return <ErrorState error={tripQuery.error} onRetry={() => void tripQuery.refetch()} />;
  }

  const trip = tripQuery.data?.trip;
  if (!trip) {
    return (
      <Card>
        <Text variant="bodyStrong">{t('error.notFound')}</Text>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-lg" aria-busy={busy}>
      <header className="flex flex-col gap-sm">
        <Text variant="title1" as="h1">
          {trip.routeShortName ?? trip.tripId}
          {trip.headsign ? ` → ${trip.headsign}` : ''}
        </Text>
        <div className="flex flex-wrap items-center gap-sm">
          {trip.agencyName ? (
            <Text variant="footnote" color="textSecondary" as="span">
              {trip.agencyName}
            </Text>
          ) : null}
          {trip.cancelled ? (
            <Badge label={t('trip.cancelled')} color={colors.danger} background={colors.dangerSubtle} />
          ) : trip.delaySeconds !== null && trip.delaySeconds >= 60 ? (
            <Badge
              label={t('trip.delay', { minutes: Math.round(trip.delaySeconds / 60) })}
              color={colors.warning}
              background={colors.warningSubtle}
            />
          ) : trip.delaySeconds !== null ? (
            <Badge label={t('trip.onTime')} color={colors.success} background={colors.successSubtle} />
          ) : null}
          <SourceBadge kind={trip.delaySeconds !== null ? 'REALTIME' : 'SCHEDULED'} />
        </div>
      </header>

      {isActive && activeTrip ? (
        <Card>
          <div className="flex flex-col gap-md">
            <Text variant="bodyStrong">{t('trip.liveOnThisTrip')}</Text>
            <Button
              label={activeTrip.following ? t('trip.followOn') : t('trip.followOff')}
              variant={activeTrip.following ? 'primary' : 'secondary'}
              onClick={() => void toggleFollow()}
              loading={busy}
            />
            <Button label={t('trip.endSession')} variant="ghost" onClick={() => void endSession()} />
          </div>
        </Card>
      ) : null}

      <section aria-labelledby="stops" className="flex flex-col gap-sm">
        <Text variant="title3" as="h2" id="stops">
          {t('trip.allStops')}
        </Text>
        <ol className="flex flex-col">
          {trip.stops.map((stop) => (
            <li
              key={`${stop.stopId}:${stop.stopSequence}`}
              className="flex items-center gap-md border-b border-border py-md last:border-b-0"
            >
              <Text variant="mono" as="span" className="w-[56px] shrink-0">
                {formatTime(stop.realtimeDeparture ?? stop.scheduledDeparture ?? stop.scheduledArrival)}
              </Text>
              <Text
                variant={stop.skipped ? 'callout' : 'body'}
                color={stop.skipped ? 'textTertiary' : 'textPrimary'}
                as="span"
                className={`flex-1 ${stop.skipped ? 'line-through' : ''}`}
              >
                {stop.stopName}
              </Text>
              <SourceBadge kind={stop.realtimeDeparture || stop.realtimeArrival ? 'REALTIME' : 'SCHEDULED'} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="trip-reports" className="flex flex-col gap-md">
        <Text variant="title3" as="h2" id="trip-reports">
          {t('tab.reports')}
        </Text>

        {reportsQuery.isLoading ? <LoadingList rows={2} /> : null}
        {reportsQuery.isError ? (
          <DataNotice message={t('error.generic')} />
        ) : reportsQuery.data && reportsQuery.data.items.length === 0 ? (
          <EmptyState title={t('trip.noReports')} body={t('trip.beFirst')} />
        ) : null}

        {(reportsQuery.data?.items ?? []).map((item) => (
          <FeedItemCard
            key={`${item.source}:${item.id}`}
            item={item}
            onVote={(reportId, value) => vote.mutate({ reportId, vote: value })}
            onOpen={(reportId) => router.push(`/reports/${reportId}`)}
          />
        ))}
      </section>
    </div>
  );
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}
