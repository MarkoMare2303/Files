import type { Trip, TripStop } from '@swissov/types';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api/endpoints.js';
import { queryKeys, useTrip, useTripReports, useVoteReport } from '../../src/api/hooks.js';
import { FeedItemCard } from '../../src/components/ReportCard.js';
import { Badge, Button, Card, Divider, Text } from '../../src/components/primitives.js';
import { DataNotice, EmptyState, ErrorState, LoadingList, SectionHeader } from '../../src/components/states.js';
import { t } from '../../src/i18n/index.js';
import { useTripReportsRealtime } from '../../src/realtime/useReportsRealtime.js';
import { useSessionStore } from '../../src/state/session.store.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Trip Screen (§14).
 *
 * Zeigt Linie, Ziel, nächsten Halt, Ankunftszeit inklusive Verspätung und den
 * Fortschritt entlang der Fahrt — darunter die Live-Meldungen der Community.
 */
export default function TripScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tripId: string; serviceDate?: string }>();

  const tripId = params.tripId ?? null;
  const serviceDate = params.serviceDate;

  const tripQuery = useTrip(tripId, serviceDate);
  const reportsQuery = useTripReports(tripId, serviceDate);
  const vote = useVoteReport(tripId ?? undefined, serviceDate);

  const activeTrip = useSessionStore((state) => state.activeTrip);
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const isActiveTrip = activeTrip?.tripId === tripId;

  useTripReportsRealtime(tripId, serviceDate ?? tripQuery.data?.trip.serviceDate ?? null);

  const trip = tripQuery.data?.trip;
  const progress = useMemo(() => computeProgress(trip), [trip]);
  const nextStop = useMemo(() => findNextStop(trip), [trip]);

  if (tripQuery.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.lg }}>
          <LoadingList rows={3} />
        </View>
      </SafeAreaView>
    );
  }

  if (tripQuery.isError || !trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.lg }}>
          <ErrorState error={tripQuery.error} onRetry={() => void tripQuery.refetch()} />
        </View>
      </SafeAreaView>
    );
  }

  const delayMinutes = trip.delaySeconds === null ? null : Math.round(trip.delaySeconds / 60);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={tripQuery.isRefetching}
            onRefresh={() => {
              void tripQuery.refetch();
              void reportsQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
      >
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Badge
              label={trip.routeShortName ?? trip.routeLongName ?? '—'}
              color="#FFFFFF"
              background={theme.vehicleColors[trip.vehicleType] ?? theme.colors.brand}
            />
            {trip.agencyName ? <Badge label={trip.agencyName} /> : null}
          </View>

          <Text variant="display" accessibilityRole="header">
            {trip.origin ?? '—'} → {trip.destination ?? '—'}
          </Text>

          {trip.cancelled ? (
            <DataNotice message={t('trip.cancelled')} />
          ) : delayMinutes === null ? (
            <DataNotice message={t('error.realtimeUnavailable')} />
          ) : null}
        </View>

        {nextStop ? (
          <Card style={{ marginTop: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="caption" color="textTertiary">
                {t('trip.nextStop')}
              </Text>
              <Text variant="title2">{nextStop.stopName}</Text>

              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.md }}>
                <Text variant="caption" color="textTertiary">
                  {t('trip.arrival')}
                </Text>
                <Text variant="mono">{formatTime(nextStop.realtimeArrival ?? nextStop.scheduledArrival)}</Text>
                {nextStop.delaySeconds !== null && nextStop.delaySeconds !== 0 ? (
                  <Text
                    variant="bodyStrong"
                    style={{
                      color:
                        nextStop.delaySeconds > 0 ? theme.colors.warning : theme.colors.success,
                    }}
                  >
                    {nextStop.delaySeconds > 0
                      ? t('trip.delay', { minutes: Math.round(nextStop.delaySeconds / 60) })
                      : t('trip.early', { minutes: Math.abs(Math.round(nextStop.delaySeconds / 60)) })}
                  </Text>
                ) : (
                  <Text variant="footnote" color="textTertiary">
                    {t('trip.onTime')}
                  </Text>
                )}
              </View>

              <ProgressBar value={progress} />
            </View>
          </Card>
        ) : null}

        {isActiveTrip && signedIn && activeTrip ? (
          <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
            <Button
              label={activeTrip.following ? t('trip.followOn') : t('trip.follow')}
              variant={activeTrip.following ? 'secondary' : 'primary'}
              onPress={async () => {
                await api.followSession(activeTrip.id, !activeTrip.following);
                await queryClient.invalidateQueries({ queryKey: queryKeys.session });
              }}
            />
            <Button
              label={t('trip.endSession')}
              variant="ghost"
              onPress={async () => {
                await api.endSession(activeTrip.id);
                await queryClient.invalidateQueries({ queryKey: queryKeys.session });
                router.back();
              }}
            />
          </View>
        ) : null}

        <SectionHeader title={t('trip.liveOnThisTrip')} />
        <View style={{ gap: theme.spacing.md }}>
          {reportsQuery.isLoading ? <LoadingList rows={2} /> : null}
          {reportsQuery.data?.items.length === 0 ? (
            <EmptyState
              title={t('trip.noReports')}
              body={t('trip.beFirst')}
              action={{ label: t('report.create'), onPress: () => router.push('/report') }}
            />
          ) : null}
          {(reportsQuery.data?.items ?? []).map((item) => (
            <FeedItemCard
              key={`${item.source}-${item.id}`}
              item={item}
              onVote={(reportId, value) => vote.mutate({ reportId, vote: value })}
            />
          ))}
        </View>

        <SectionHeader title={t('trip.allStops')} />
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            {trip.stops.map((stop, index) => (
              <React.Fragment key={`${stop.stopId}-${stop.stopSequence}`}>
                <StopRow stop={stop} isNext={stop.stopId === nextStop?.stopId} />
                {index < trip.stops.length - 1 ? <Divider /> : null}
              </React.Fragment>
            ))}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function StopRow({ stop, isNext }: { stop: TripStop; isNext: boolean }): React.JSX.Element {
  const theme = useTheme();
  const time = stop.realtimeArrival ?? stop.scheduledArrival ?? stop.scheduledDeparture;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: isNext ? theme.colors.brand : theme.colors.borderStrong,
        }}
      />
      <Text
        variant={isNext ? 'bodyStrong' : 'body'}
        color={stop.skipped ? 'textTertiary' : 'textPrimary'}
        style={{ flex: 1, textDecorationLine: stop.skipped ? 'line-through' : 'none' }}
        numberOfLines={1}
      >
        {stop.stopName}
      </Text>
      {stop.platformCode ? <Badge label={stop.platformCode} /> : null}
      <Text variant="mono" color={isNext ? 'textPrimary' : 'textSecondary'}>
        {formatTime(time)}
      </Text>
    </View>
  );
}

function ProgressBar({ value }: { value: number }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={{
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceSunken,
        overflow: 'hidden',
        marginTop: theme.spacing.sm,
      }}
    >
      <View
        style={{
          width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
          height: '100%',
          backgroundColor: theme.colors.brand,
        }}
      />
    </View>
  );
}

function findNextStop(trip: Trip | undefined): TripStop | null {
  if (!trip) return null;
  const now = Date.now();
  return (
    trip.stops.find((stop) => {
      const at = stop.realtimeArrival ?? stop.scheduledArrival;
      return at !== null && new Date(at).getTime() > now;
    }) ??
    trip.stops[trip.stops.length - 1] ??
    null
  );
}

/** Fortschritt aus der Zeit zwischen erstem und letztem Halt. */
function computeProgress(trip: Trip | undefined): number {
  if (!trip || trip.stops.length < 2) return 0;
  const first = trip.stops[0]!;
  const last = trip.stops[trip.stops.length - 1]!;
  const start = new Date(first.realtimeDeparture ?? first.scheduledDeparture ?? Date.now()).getTime();
  const end = new Date(last.realtimeArrival ?? last.scheduledArrival ?? Date.now()).getTime();
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
