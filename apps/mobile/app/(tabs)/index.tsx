import MapLibreGL, { Camera, MapView, MarkerView, UserLocation } from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNearbyReports, useNearbyStops } from '../../src/api/hooks.js';
import { Badge, Button, Card, Text } from '../../src/components/primitives.js';
import { DataNotice, SectionHeader } from '../../src/components/states.js';
import { SWITZERLAND_CENTER, SWITZERLAND_DEFAULT_ZOOM, config, isMapConfigured } from '../../src/config.js';
import { t } from '../../src/i18n/index.js';
import { useLocation } from '../../src/location/useLocation.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Startansicht: interaktive Karte der Schweiz (§13).
 *
 * Angezeigt werden ausschliesslich Dinge, die wir wirklich wissen: eigene
 * Position, Haltestellen, Community-Meldungen und offizielle Störungen.
 * Es werden KEINE erfundenen Fahrzeugpositionen dargestellt (§9/§13).
 */
MapLibreGL.setAccessToken(null);

export default function MapScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { latest, permission, requestPermission, getCurrent } = useLocation();
  const [showReports, setShowReports] = useState(true);
  const [showStops, setShowStops] = useState(true);

  useEffect(() => {
    if (permission === 'granted') void getCurrent();
  }, [permission, getCurrent]);

  const center = latest ? [latest.lon, latest.lat] : [SWITZERLAND_CENTER.longitude, SWITZERLAND_CENTER.latitude];
  const zoom = latest ? 13.5 : SWITZERLAND_DEFAULT_ZOOM;

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

  if (!isMapConfigured) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ flex: 1, padding: theme.spacing.lg, justifyContent: 'center' }}>
          <DataNotice message={t('map.noStyle')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <MapView
        style={{ flex: 1 }}
        mapStyle={config.mapStyleUrl}
        logoEnabled={false}
        attributionPosition={{ bottom: 96, right: 8 }}
        compassEnabled
      >
        <Camera
          defaultSettings={{ centerCoordinate: center, zoomLevel: zoom }}
          centerCoordinate={latest ? center : undefined}
          zoomLevel={latest ? zoom : undefined}
          animationDuration={600}
        />

        {permission === 'granted' ? <UserLocation visible androidRenderMode="compass" /> : null}

        {showStops
          ? (stopsQuery.data?.stops ?? []).map((stop) => (
              <MarkerView key={stop.stopId} coordinate={[stop.lon, stop.lat]} anchor={{ x: 0.5, y: 0.5 }}>
                <Pressable
                  onPress={() => router.push(`/stop/${encodeURIComponent(stop.stopId)}`)}
                  accessibilityRole="button"
                  accessibilityLabel={stop.name}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 3,
                    borderColor: theme.colors.brand,
                  }}
                />
              </MarkerView>
            ))
          : null}

        {showReports
          ? communityReports.map((report) => (
              <MarkerView
                key={report.id}
                coordinate={[report.lon!, report.lat!]}
                anchor={{ x: 0.5, y: 1 }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={report.categoryLabel.de}
                  onPress={() =>
                    report.tripId
                      ? router.push(`/trip/${encodeURIComponent(report.tripId)}`)
                      : undefined
                  }
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: theme.radius.pill,
                    backgroundColor: report.categoryColor,
                  }}
                >
                  <Text variant="caption" style={{ color: '#FFFFFF' }}>
                    {report.categoryLabel.de}
                  </Text>
                </Pressable>
              </MarkerView>
            ))
          : null}
      </MapView>

      <SafeAreaView
        edges={['top']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        pointerEvents="box-none"
      >
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
          <Pressable onPress={() => router.push('/search')} accessibilityRole="search">
            <Card style={{ paddingVertical: theme.spacing.md }}>
              <Text variant="callout" color="textTertiary">
                {t('home.searchPlaceholder')}
              </Text>
            </Card>
          </Pressable>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            <LayerToggle
              label={t('map.layer.stops')}
              active={showStops}
              onPress={() => setShowStops(!showStops)}
            />
            <LayerToggle
              label={t('map.layer.reports')}
              active={showReports}
              onPress={() => setShowReports(!showReports)}
            />
          </ScrollView>
        </View>
      </SafeAreaView>

      {permission !== 'granted' ? (
        <SafeAreaView
          edges={['bottom']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
          pointerEvents="box-none"
        >
          <View style={{ padding: theme.spacing.lg }}>
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                <Text variant="bodyStrong">{t('location.title')}</Text>
                <Text variant="footnote" color="textSecondary">
                  {t('location.body')}
                </Text>
                <Button label={t('location.enable')} onPress={() => void requestPermission()} />
              </View>
            </Card>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function LayerToggle({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
    >
      <Badge
        label={label}
        color={active ? theme.colors.textOnBrand : theme.colors.textSecondary}
        background={active ? theme.colors.brand : theme.colors.surface}
      />
    </Pressable>
  );
}

export { SectionHeader };
