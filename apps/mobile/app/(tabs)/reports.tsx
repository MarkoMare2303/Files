import React, { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api/endpoints.js';
import { useNearbyReports } from '../../src/api/hooks.js';
import { FeedItemCard } from '../../src/components/ReportCard.js';
import { Text } from '../../src/components/primitives.js';
import { DataNotice, EmptyState, ErrorState, LoadingList } from '../../src/components/states.js';
import { t } from '../../src/i18n/index.js';
import { useLocation } from '../../src/location/useLocation.js';
import { useOfflineQueue } from '../../src/state/offline-queue.store.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Meldungen in der Umgebung — offizielle und Community-Meldungen gemeinsam,
 * aber klar unterscheidbar (§7).
 */
export default function ReportsScreen(): React.JSX.Element {
  const theme = useTheme();
  const { latest, permission } = useLocation();
  const query = useNearbyReports(latest?.lat ?? null, latest?.lon ?? null);
  const queued = useOfflineQueue((state) => state.items);
  const [voting, setVoting] = useState(false);

  async function vote(reportId: string, value: 1 | -1): Promise<void> {
    setVoting(true);
    try {
      await api.voteReport(reportId, value);
      await query.refetch();
    } finally {
      setVoting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !voting}
            onRefresh={() => void query.refetch()}
            tintColor={theme.colors.brand}
          />
        }
      >
        <Text variant="title1" accessibilityRole="header">
          {t('tab.reports')}
        </Text>

        {queued.length > 0 ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <DataNotice message={t('report.successOffline')} />
          </View>
        ) : null}

        {permission !== 'granted' ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <DataNotice message={t('location.denied.body')} />
          </View>
        ) : null}

        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
          {query.isLoading ? <LoadingList rows={3} /> : null}
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : null}
          {query.data?.items.length === 0 ? <EmptyState title={t('home.noReports')} /> : null}

          {(query.data?.items ?? []).map((item) => (
            <FeedItemCard
              key={`${item.source}-${item.id}`}
              item={item}
              onVote={(reportId, value) => void vote(reportId, value)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
