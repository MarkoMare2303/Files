'use client';

import type { TripCandidate } from '@swissov/types';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { api } from '../../../src/api/endpoints';
import { queryKeys, useCurrentSession } from '../../../src/api/hooks';
import { Badge, Button, Card, Text } from '../../../src/components/primitives';
import { DataNotice, EmptyState, LoadingList } from '../../../src/components/states';
import { t } from '../../../src/i18n/index';
import { useLocation } from '../../../src/location/useLocation';
import { useTripDetection } from '../../../src/location/useTripDetection';
import { useSessionStore } from '../../../src/state/session.store';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Fahrten: automatische Erkennung und manuelle Auswahl (§11/§12).
 *
 * Kernregel: Der Nutzer wird nie ausgesperrt. Auch wenn GPS nichts liefert,
 * führt „Meine Fahrt auswählen" über Haltestellen und Abfahrten zum Ziel.
 *
 * Web-spezifisch: Die Ortung läuft nur bei geöffneter Seite. Das steht als
 * Hinweis in der Oberfläche — nicht im Kleingedruckten (§55).
 */
export default function TripsPage(): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();

  const { observations, permission, supported, requestPermission, watching } = useLocation({
    watch: true,
  });
  const detection = useTripDetection(observations);
  useCurrentSession();

  const activeTrip = useSessionStore((state) => state.activeTrip);
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const [starting, setStarting] = useState<string | null>(null);

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
      router.push(
        `/trip/${encodeURIComponent(candidate.tripId)}?serviceDate=${candidate.serviceDate}`,
      );
    } finally {
      setStarting(null);
    }
  }

  // Automatische Übernahme, wenn die Erkennung eindeutig ist (§11).
  useEffect(() => {
    if (!signedIn || activeTrip || detection.decision !== 'AUTO_SELECT' || !detection.best) return;
    void confirmTrip(detection.best, 'AUTO_GPS');
    // Absichtlich nur auf die Identität der erkannten Fahrt reagieren.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.decision, detection.best, signedIn, activeTrip]);

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="title1" as="h1">
        {t('tab.trips')}
      </Text>

      {activeTrip ? (
        <Card
          onClick={() =>
            router.push(
              `/trip/${encodeURIComponent(activeTrip.tripId)}?serviceDate=${activeTrip.serviceDate}`,
            )
          }
          ariaLabel={t('home.openTrip')}
        >
          <div className="flex flex-col gap-sm">
            <Badge
              label={t('detection.confidence', {
                percent: Math.round(activeTrip.confidence * 100),
              })}
              color={colors.success}
              background={colors.successSubtle}
            />
            <Text variant="title3" as="h2">
              {activeTrip.tripId}
            </Text>
            <Text variant="footnote" color="textSecondary">
              {activeTrip.serviceDate}
            </Text>
          </div>
        </Card>
      ) : null}

      {permission !== 'granted' ? (
        <Card>
          <div className="flex flex-col gap-md">
            <Text variant="bodyStrong">{t('location.title')}</Text>
            <Text variant="footnote" color="textSecondary">
              {t('location.body')}
            </Text>
            {supported ? (
              <Button label={t('location.enable')} onClick={() => void requestPermission()} />
            ) : (
              <DataNotice message={t('location.unsupported')} />
            )}
            <Button
              label={t('detection.manualButton')}
              variant="secondary"
              onClick={() => router.push('/search')}
            />
          </div>
        </Card>
      ) : (
        <DataNotice message={t('location.foregroundOnly')} />
      )}

      {permission === 'granted' && !activeTrip ? (
        <section aria-live="polite" className="flex flex-col gap-md">
          <Text variant="title3" as="h2">
            {watching ? t('location.watching') : t('location.paused')}
          </Text>

          {detection.isLoading ? <LoadingList rows={2} /> : null}

          {!detection.isLoading && detection.decision === 'AUTO_SELECT' && detection.best ? (
            <CandidateCard
              candidate={detection.best}
              busy={starting === detection.best.tripId}
              onConfirm={() => void confirmTrip(detection.best!, 'AUTO_GPS')}
            />
          ) : null}

          {!detection.isLoading && detection.decision === 'CONFIRM' && detection.best ? (
            <div className="flex flex-col gap-md">
              <Text variant="bodyStrong">{t('detection.confirmQuestion')}</Text>
              <CandidateCard
                candidate={detection.best}
                busy={starting === detection.best.tripId}
                onConfirm={() => void confirmTrip(detection.best!, 'MANUAL')}
              />
              <Button
                label={t('detection.chooseOther')}
                variant="secondary"
                onClick={() => router.push('/search')}
              />
            </div>
          ) : null}

          {!detection.isLoading && detection.decision === 'CHOOSE' ? (
            <div className="flex flex-col gap-md">
              <Text variant="bodyStrong">{t('detection.chooseTitle')}</Text>
              {detection.candidates.map((candidate) => (
                <CandidateCard
                  key={`${candidate.tripId}:${candidate.serviceDate}`}
                  candidate={candidate}
                  busy={starting === candidate.tripId}
                  onConfirm={() => void confirmTrip(candidate, 'MANUAL')}
                />
              ))}
            </div>
          ) : null}

          {!detection.isLoading && detection.decision === 'NONE' ? (
            <EmptyState
              title={t('detection.notFound.title')}
              body={t('detection.notFound.body')}
              action={{ label: t('detection.manualButton'), onPress: () => router.push('/search') }}
            />
          ) : null}

          {detection.decision === 'IDLE' && !detection.isLoading ? (
            <Text variant="callout" color="textSecondary">
              {t('detection.searching')}
            </Text>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CandidateCard({
  candidate,
  busy,
  onConfirm,
}: {
  candidate: TripCandidate;
  busy: boolean;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <Card>
      <div className="flex flex-col gap-sm">
        <Text variant="bodyStrong" as="h3">
          {candidate.routeShortName ?? candidate.tripId}
          {candidate.headsign ? ` → ${candidate.headsign}` : ''}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {t('detection.confidence', { percent: Math.round(candidate.confidence * 100) })}
        </Text>
        <Button
          label={t('detection.confirmYes')}
          onClick={onConfirm}
          loading={busy}
          data-testid="confirm-trip"
        />
      </div>
    </Card>
  );
}
