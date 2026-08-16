'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { api } from '../../../src/api/endpoints';
import { useNearbyReports } from '../../../src/api/hooks';
import { FeedItemCard } from '../../../src/components/ReportCard';
import { Button, Text } from '../../../src/components/primitives';
import { DataNotice, EmptyState, ErrorState, LoadingList } from '../../../src/components/states';
import { t } from '../../../src/i18n/index';
import { useLocation } from '../../../src/location/useLocation';

/**
 * Meldungsliste in der Umgebung (§14).
 *
 * Offizielle Meldungen und Community-Beobachtungen stehen in derselben Liste,
 * bleiben aber unverwechselbar getrennt gekennzeichnet (§7).
 */
export default function ReportsPage(): React.JSX.Element {
  const router = useRouter();
  const { latest, permission, supported, requestPermission, getCurrent } = useLocation();
  const [voting, setVoting] = useState<string | null>(null);

  useEffect(() => {
    if (permission === 'granted') void getCurrent();
  }, [permission, getCurrent]);

  const query = useNearbyReports(latest?.lat ?? null, latest?.lon ?? null);

  async function vote(reportId: string, value: 1 | -1): Promise<void> {
    setVoting(reportId);
    try {
      await api.voteReport(reportId, value);
      await query.refetch();
    } finally {
      setVoting(null);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="title1" as="h1">
        {t('tab.reports')}
      </Text>

      {permission !== 'granted' ? (
        <div className="flex flex-col gap-md">
          <DataNotice message={t('location.body')} />
          {supported ? (
            <Button label={t('location.enable')} onClick={() => void requestPermission()} />
          ) : (
            <DataNotice message={t('location.unsupported')} />
          )}
        </div>
      ) : null}

      {query.isLoading ? <LoadingList rows={4} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}

      {query.data && query.data.items.length === 0 ? (
        <EmptyState title={t('empty.reports')} body={t('home.noReports')} />
      ) : null}

      <div className="flex flex-col gap-md" aria-busy={voting !== null}>
        {(query.data?.items ?? []).map((item) => (
          <FeedItemCard
            key={`${item.source}:${item.id}`}
            item={item}
            onVote={(reportId, value) => void vote(reportId, value)}
            onOpen={(reportId) => router.push(`/reports/${reportId}`)}
          />
        ))}
      </div>
    </div>
  );
}
