import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/api/endpoints.js';
import { queryKeys, useDepartures } from '../../src/api/hooks.js';
import { FeedItemCard } from '../../src/components/ReportCard.js';
import { Badge, Card, Divider, Text } from '../../src/components/primitives.js';
import { DataNotice, EmptyState, ErrorState, LoadingList, SectionHeader } from '../../src/components/states.js';
import { t } from '../../src/i18n/index.js';
import { useStopReportsRealtime } from '../../src/realtime/useReportsRealtime.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Haltestellenansicht: Abfahrtstafel plus Meldungen zu dieser Station.
 */
export default function StopScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ stopId: string }>();
  const stopId = params.stopId ?? null;

  const stopQuery = useQuery({
    queryKey: queryKeys.stop(stopId ?? ''),
    enabled: Boolean(stopId),
    queryFn: () => api.stop(stopId!),
    staleTime: 10 * 60_000,
  });
  const departuresQuery = useDepartures(stopId);
  const reportsQuery = useQuery({
    queryKey: ['reports', 'stop', stopId],
    enabled: Boolean(stopId),
    queryFn: () => api.reports({ stopId: stopId!, includeOfficial: true, limit: 30 }),
    staleTime: 20_000,
  });

  useStopReportsRealtime(stopId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={departuresQuery.isRefetching}
            onRefresh={() => void departuresQuery.refetch()}
            tintColor={theme.colors.brand}
          />
        }
      >
        <Text variant="display" accessibilityRole="header">
          {stopQuery.data?.stop.name ?? '…'}
        </Text>
        {stopQuery.data?.stop.wheelchairBoarding === 1 ? (
          <View style={{ marginTop: theme.spacing.sm, alignSelf: 'flex-start' }}>
            <Badge
              label="♿"
              color={theme.colors.success}
              background={theme.colors.successSubtle}
            />
          </View>
        ) : null}

        <SectionHeader title={t('home.nextDepartures')} />

        {departuresQuery.isLoading ? <LoadingList rows={3} /> : null}
        {departuresQuery.isError ? (
          <ErrorState error={departuresQuery.error} onRetry={() => void departuresQuery.refetch()} />
        ) : null}
        {departuresQuery.data && !departuresQuery.data.realtimeAvailable ? (
          <View style={{ marginBottom: theme.spacing.md }}>
            <DataNotice message={t('error.realtimeUnavailable')} />
          </View>
        ) : null}
        {departuresQuery.data?.departures.length === 0 ? (
          <EmptyState title={t('manual.noDepartures')} />
        ) : null}

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            {(departuresQuery.data?.departures ?? []).map((departure, index, all) => {
              const time = departure.realtimeDeparture ?? departure.scheduledDeparture;
              const delayMinutes =
                departure.delaySeconds === null ? null : Math.round(departure.delaySeconds / 60);

              return (
                <React.Fragment key={`${departure.tripId}-${departure.scheduledDeparture}`}>
                  <View
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`${departure.routeShortName ?? ''} ${departure.headsign ?? ''}`}
                    onTouchEnd={() =>
                      router.push(
                        `/trip/${encodeURIComponent(departure.tripId)}?serviceDate=${departure.serviceDate}`,
                      )
                    }
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                  >
                    <Badge
                      label={departure.routeShortName ?? '—'}
                      color="#FFFFFF"
                      background={theme.vehicleColors[departure.vehicleType] ?? theme.colors.brand}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1}>
                        {departure.headsign ?? '—'}
                      </Text>
                      {departure.platformCode ? (
                        <Text variant="caption" color="textTertiary">
                          {departure.platformCode}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="mono">{formatTime(time)}</Text>
                      {departure.cancelled ? (
                        <Text variant="caption" style={{ color: theme.colors.danger }}>
                          {t('trip.cancelled')}
                        </Text>
                      ) : delayMinutes !== null && delayMinutes !== 0 ? (
                        <Text
                          variant="caption"
                          style={{
                            color: delayMinutes > 0 ? theme.colors.warning : theme.colors.success,
                          }}
                        >
                          {delayMinutes > 0
                            ? t('trip.delay', { minutes: delayMinutes })
                            : t('trip.early', { minutes: Math.abs(delayMinutes) })}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {index < all.length - 1 ? <Divider /> : null}
                </React.Fragment>
              );
            })}
          </View>
        </Card>

        <SectionHeader title={t('home.currentReports')} />
        <View style={{ gap: theme.spacing.md }}>
          {reportsQuery.data?.items.length === 0 ? <EmptyState title={t('empty.reports')} /> : null}
          {(reportsQuery.data?.items ?? []).map((item) => (
            <FeedItemCard key={`${item.source}-${item.id}`} item={item} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
