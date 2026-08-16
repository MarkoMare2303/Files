'use client';

import { useParams, useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { api } from '../../../../src/api/endpoints';
import { useReport } from '../../../../src/api/hooks';
import { FeedItemCard } from '../../../../src/components/ReportCard';
import { Button, Card, Text } from '../../../../src/components/primitives';
import { ErrorState, LoadingList } from '../../../../src/components/states';
import { t } from '../../../../src/i18n/index';

/**
 * Einzelne Meldung (§14).
 *
 * Diese Route existiert vor allem als Ziel für Push-Benachrichtigungen:
 * `notificationclick` öffnet `/reports/<id>`. Sie muss deshalb auch ohne
 * vorherige Navigation und ohne Standortfreigabe vollständig funktionieren.
 */
export default function ReportDetailPage(): React.JSX.Element {
  const params = useParams<{ reportId: string }>();
  const router = useRouter();
  const reportId = typeof params.reportId === 'string' ? params.reportId : null;

  const query = useReport(reportId);
  const [busy, setBusy] = useState(false);

  async function vote(value: 1 | -1): Promise<void> {
    if (!reportId) return;
    setBusy(true);
    try {
      await api.voteReport(reportId, value);
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) return <LoadingList rows={1} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const report = query.data?.report;
  if (!report) {
    return (
      <Card>
        <Text variant="bodyStrong">{t('error.notFound')}</Text>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-lg" aria-busy={busy}>
      <Text variant="title1" as="h1">
        {t('tab.reports')}
      </Text>

      <FeedItemCard
        item={{ ...report, source: 'COMMUNITY' }}
        onVote={(_id, value) => void vote(value)}
      />

      {report.tripId ? (
        <Button
          label={t('home.openTrip')}
          variant="secondary"
          onClick={() =>
            router.push(
              `/trip/${encodeURIComponent(report.tripId as string)}${
                report.serviceDate ? `?serviceDate=${report.serviceDate}` : ''
              }`,
            )
          }
        />
      ) : null}

      <Button label={t('common.back')} variant="ghost" onClick={() => router.push('/reports')} />
    </div>
  );
}
