import { confidenceBand } from '@swissov/shared';
import type { TripCandidate } from '@swissov/types';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api/endpoints.js';
import { queryKeys, useCurrentSession, useNearbyStops } from '../../src/api/hooks.js';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Divider, Text } from '../../src/components/primitives.js';
import { EmptyState, ErrorState, LoadingList, SectionHeader } from '../../src/components/states.js';
import { t } from '../../src/i18n/index.js';
import { useLocation } from '../../src/location/useLocation.js';
import { useTripDetection } from '../../src/location/useTripDetection.js';
import { useSessionStore } from '../../src/state/session.store.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Fahrten-Tab: automatische Erkennung und manuelle Auswahl (§11/§12).
 *
 * Kernregel: Der Nutzer wird nie ausgesperrt. Auch wenn GPS nichts liefert,
 * führt „Meine Fahrt auswählen" über Haltestellen und Abfahrten zum Ziel.
 */
export default function TripsScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { observations, latest, permission, requestPermission } = useLocation({ watch: true });
  const detection = useTripDetection(observations);
  const sessionQuery = useCurrentSession();
  const activeTrip = useSessionStore((state) => state.activeTrip);
  const signedIn = useSessionStore((state) => state.accessToken !== null);

  const [starting, setStarting] = useState<string | null>(null);

  // Automatische Übernahme, wenn die Erkennung eindeutig ist (§11).
  useEffect(() => {
    if (!signedIn || activeTrip || detection.decision !== 'AUTO_SELECT' || !detection.best) return;
    void confirmTrip(detection.best, 'AUTO_GPS');
    // Absichtlich nur auf die Identität der erkannten Fahrt reagieren:
    // `confirmTrip` ändert sich bei jedem Render, würde die Sitzung aber
    // nicht erneut starten dürfen.
  }, [detection.decision, detection.best, signedIn, activeTrip]);

  async function confirmTrip(
    candidate: TripCandidate,
    method: 'AUTO_GPS' | 'MANUAL',
  ): Promise<void> {
    if (!signedIn) {
      router.push('/login');
      return;
    }
    setStarting(candidate.tripId);
    try {
      await api.startSession({
        tripId: candidate.tripId,
        serviceDate: candidate.serviceDate,
        confidence: candidate.confidence,
        detectionMethod: method,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      router.push(`/trip/${encodeURIComponent(candidate.tripId)}?serviceDate=${candidate.serviceDate}`);
    } finally {
      setStarting(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}>
        <Text variant="title1" accessibilityRole="header">
          {t('tab.trips')}
        </Text>

        {activeTrip ? (
          <>
            <SectionHeader title={t('trip.liveOnThisTrip')} />
            <Card
              onPress={() =>
                router.push(
                  `/trip/${encodeURIComponent(activeTrip.tripId)}?serviceDate=${activeTrip.serviceDate}`,
                )
              }
            >
              <View style={{ gap: theme.spacing.sm }}>
                <Badge
                  label={t('detection.confidence', {
                    percent: Math.round(activeTrip.confidence * 100),
                  })}
                  color={theme.colors.success}
                  background={theme.colors.successSubtle}
                />
                <Text variant="title3">{activeTrip.tripId}</Text>
                <Text variant="footnote" color="textSecondary">
                  {activeTrip.serviceDate}
                </Text>
                <Button
                  label={t('home.openTrip')}
                  onPress={() =>
                    router.push(
                      `/trip/${encodeURIComponent(activeTrip.tripId)}?serviceDate=${activeTrip.serviceDate}`,
                    )
                  }
                />
              </View>
            </Card>
          </>
        ) : null}

        {permission !== 'granted' ? (
          <Card style={{ marginTop: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.md }}>
              <Text variant="bodyStrong">{t('location.title')}</Text>
              <Text variant="footnote" color="textSecondary">
                {t('location.body')}
              </Text>
              <Button label={t('location.enable')} onPress={() => void requestPermission()} />
              <Button
                label={t('detection.manualButton')}
                variant="secondary"
                onPress={() => router.push('/search')}
              />
            </View>
          </Card>
        ) : null}

        {permission === 'granted' && !activeTrip ? (
          <DetectionSection
            detection={detection}
            starting={starting}
            onConfirm={(candidate) => void confirmTrip(candidate, 'MANUAL')}
            onManual={() => router.push('/search')}
          />
        ) : null}

        {!activeTrip ? (
          <NearbyDepartures lat={latest?.lat ?? null} lon={latest?.lon ?? null} />
        ) : null}

        {sessionQuery.isError ? <ErrorState error={sessionQuery.error} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetectionSection({
  detection,
  starting,
  onConfirm,
  onManual,
}: {
  detection: ReturnType<typeof useTripDetection>;
  starting: string | null;
  onConfirm: (candidate: TripCandidate) => void;
  onManual: () => void;
}): React.JSX.Element {
  const theme = useTheme();

  if (detection.isLoading) {
    return (
      <View style={{ marginTop: theme.spacing.lg }}>
        <SectionHeader title={t('detection.searching')} />
        <LoadingList rows={2} />
      </View>
    );
  }

  if (detection.decision === 'NONE' || detection.candidates.length === 0) {
    return (
      <View style={{ marginTop: theme.spacing.lg }}>
        <EmptyState
          title={t('detection.notFound.title')}
          body={t('detection.notFound.body')}
          action={{ label: t('detection.manualButton'), onPress: onManual }}
        />
      </View>
    );
  }

  const best = detection.candidates[0]!;
  const showAsConfirmation = detection.decision === 'CONFIRM';

  return (
    <View style={{ marginTop: theme.spacing.lg }}>
      <SectionHeader
        title={showAsConfirmation ? t('detection.confirmQuestion') : t('detection.chooseTitle')}
      />

      {showAsConfirmation ? (
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <CandidateSummary candidate={best} />
            <Button
              label={t('detection.confirmYes')}
              onPress={() => onConfirm(best)}
              loading={starting === best.tripId}
            />
            <Button label={t('detection.chooseOther')} variant="ghost" onPress={onManual} />
          </View>
        </Card>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {detection.candidates.map((candidate) => (
            <Card
              key={`${candidate.tripId}-${candidate.serviceDate}`}
              onPress={() => onConfirm(candidate)}
              accessibilityLabel={`${candidate.routeShortName ?? ''} ${candidate.destination ?? ''}`}
            >
              <CandidateSummary candidate={candidate} />
            </Card>
          ))}
          <Button label={t('detection.manualButton')} variant="secondary" onPress={onManual} />
        </View>
      )}
    </View>
  );
}

function CandidateSummary({ candidate }: { candidate: TripCandidate }): React.JSX.Element {
  const theme = useTheme();
  const band = confidenceBand(candidate.confidence);
  const bandColor =
    band === 'high' ? theme.colors.success : band === 'medium' ? theme.colors.warning : theme.colors.textTertiary;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Badge
          label={candidate.routeShortName ?? candidate.routeLongName ?? '—'}
          color={theme.colors.textOnBrand}
          background={theme.vehicleColors[candidate.vehicleType] ?? theme.colors.brand}
        />
        <Badge
          label={t('detection.confidence', { percent: Math.round(candidate.confidence * 100) })}
          color={bandColor}
        />
      </View>
      <Text variant="title3">
        {candidate.origin ?? '—'} → {candidate.destination ?? '—'}
      </Text>
      {candidate.nextStopName ? (
        <Text variant="footnote" color="textSecondary">
          {t('trip.nextStop')}: {candidate.nextStopName}
        </Text>
      ) : null}
    </View>
  );
}

function NearbyDepartures({ lat, lon }: { lat: number | null; lon: number | null }): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const stopsQuery = useNearbyStops(lat, lon, 800);

  if (!lat || !lon) return <View />;

  return (
    <View style={{ marginTop: theme.spacing.lg }}>
      <SectionHeader title={t('home.nearby')} />
      {stopsQuery.isLoading ? <LoadingList rows={2} /> : null}
      {stopsQuery.data?.stops.length === 0 ? (
        <EmptyState title={t('home.noNearbyStops')} />
      ) : null}
      <View style={{ gap: theme.spacing.sm }}>
        {(stopsQuery.data?.stops ?? []).slice(0, 6).map((stop, index, all) => (
          <React.Fragment key={stop.stopId}>
            <Card onPress={() => router.push(`/stop/${encodeURIComponent(stop.stopId)}`)}>
              <View style={{ gap: theme.spacing.xxs }}>
                <Text variant="bodyStrong">{stop.name}</Text>
                <Text variant="footnote" color="textTertiary">
                  {stop.distanceMeters !== null && stop.distanceMeters !== undefined
                    ? `${stop.distanceMeters} m`
                    : ''}
                </Text>
              </View>
            </Card>
            {index < all.length - 1 ? null : null}
          </React.Fragment>
        ))}
      </View>
      <Divider />
    </View>
  );
}
