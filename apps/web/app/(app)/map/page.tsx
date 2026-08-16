'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { useNearbyReports, useNearbyStops } from '../../../src/api/hooks';
import { MapCanvas, type MapMarker } from '../../../src/components/MapCanvas';
import { FeedItemCard } from '../../../src/components/ReportCard';
import { Button, Card, Switch, Text } from '../../../src/components/primitives';
import { DataNotice, EmptyState, SectionHeader } from '../../../src/components/states';
import { pick, t } from '../../../src/i18n/index';
import { useLocation } from '../../../src/location/useLocation';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Startansicht: interaktive Karte der Schweiz (§13).
 *
 * Angezeigt werden ausschliesslich Dinge, die wir wirklich wissen: eigene
 * Position, Haltestellen, Community-Meldungen und offizielle Störungen.
 * Es werden KEINE erfundenen Fahrzeugpositionen dargestellt (§9/§13).
 */
export default function MapPage(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useTheme();
  const { latest, permission, supported, requestPermission, getCurrent, errorKey } = useLocation();
  const [showReports, setShowReports] = useState(true);
  const [showStops, setShowStops] = useState(true);

  useEffect(() => {
    if (permission === 'granted') void getCurrent();
  }, [permission, getCurrent]);

  const stopsQuery = useNearbyStops(latest?.lat ?? null, latest?.lon ?? null, 1500);
  const reportsQuery = useNearbyReports(latest?.lat ?? null, latest?.lon ?? null);

  const communityReports = useMemo(
    () =>
      (reportsQuery.data?.items ?? []).filter(
        (item): item is Extract<typeof item, { source: 'COMMUNITY' }> =>
          item.source === 'COMMUNITY' && item.lat !== null && item.lon !== null,
      ),
    [reportsQuery.data],
  );

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];

    if (latest) {
      list.push({
        id: 'self',
        lat: latest.lat,
        lon: latest.lon,
        color: colors.brand,
        label: t('location.watching'),
        kind: 'SELF',
      });
    }

    if (showStops) {
      for (const stop of stopsQuery.data?.stops ?? []) {
        list.push({
          id: `stop:${stop.stopId}`,
          lat: stop.lat,
          lon: stop.lon,
          color: colors.textSecondary,
          label: stop.name,
          kind: 'STOP',
          onClick: () => router.push(`/stop/${encodeURIComponent(stop.stopId)}`),
        });
      }
    }

    if (showReports) {
      for (const report of communityReports) {
        list.push({
          id: `report:${report.id}`,
          lat: report.lat as number,
          lon: report.lon as number,
          color: report.categoryColor,
          label: pick(report.categoryLabel),
          kind: 'REPORT',
          onClick: () => router.push(`/reports/${report.id}`),
        });
      }
    }

    return list;
  }, [colors, communityReports, latest, router, showReports, showStops, stopsQuery.data]);

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="title1" as="h1">
        {t('tab.map')}
      </Text>

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
            {errorKey ? <DataNotice message={t(errorKey as 'error.generic')} /> : null}
          </div>
        </Card>
      ) : null}

      <MapCanvas
        center={latest ? { lat: latest.lat, lon: latest.lon } : null}
        zoom={latest ? 13.5 : undefined}
        markers={markers}
        className="h-[52dvh] min-h-[280px]"
      />

      <div className="flex flex-col gap-xs rounded-lg border border-border bg-surface px-lg">
        <Switch checked={showStops} onChange={setShowStops} label={t('home.nearby')} />
        <Switch checked={showReports} onChange={setShowReports} label={t('home.currentReports')} />
      </div>

      <SectionHeader title={t('home.currentReports')} />
      {reportsQuery.data && reportsQuery.data.items.length === 0 ? (
        <EmptyState title={t('home.noReports')} />
      ) : (
        <div className="flex flex-col gap-md">
          {(reportsQuery.data?.items ?? []).slice(0, 10).map((item) => (
            <FeedItemCard
              key={`${item.source}:${item.id}`}
              item={item}
              onOpen={(reportId) => router.push(`/reports/${reportId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
