'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { useFavorites, useMyReports } from '../../../src/api/hooks';
import { FeedItemCard } from '../../../src/components/ReportCard';
import { Badge, Button, Card, Text } from '../../../src/components/primitives';
import { EmptyState, LoadingList, SectionHeader } from '../../../src/components/states';
import { t } from '../../../src/i18n/index';
import { useSessionStore } from '../../../src/state/session.store';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Profil: Reputation, eigene Meldungen, Favoriten (§20).
 *
 * Der Alias ist pseudonym — Klarname oder E-Mail werden nie angezeigt (§23).
 */
export default function ProfilePage(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useTheme();
  const profile = useSessionStore((state) => state.profile);
  const signedIn = useSessionStore((state) => state.accessToken !== null);

  const reportsQuery = useMyReports();
  const favoritesQuery = useFavorites();

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-lg">
        <Text variant="title1" as="h1">
          {t('tab.profile')}
        </Text>
        <EmptyState
          title={t('profile.guest')}
          body={t('profile.guestBody')}
          action={{ label: t('profile.signIn'), onPress: () => router.push('/login') }}
        />
        <Button
          label={t('settings.title')}
          variant="secondary"
          onClick={() => router.push('/settings')}
        />
      </div>
    );
  }

  const tierLabel =
    profile?.reputationTier === 'TRUSTED'
      ? t('profile.tier.TRUSTED')
      : profile?.reputationTier === 'ESTABLISHED'
        ? t('profile.tier.ESTABLISHED')
        : t('profile.tier.NEW');

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="title1" as="h1">
        {t('tab.profile')}
      </Text>

      <Card>
        <div className="flex flex-col gap-sm">
          <Text variant="title3" as="h2">
            {profile?.alias ?? '—'}
          </Text>
          <div className="flex flex-wrap items-center gap-sm">
            <Badge label={tierLabel} color={colors.brand} background={colors.brandSubtle} />
            <Text variant="footnote" color="textSecondary" as="span">
              {t('profile.reportsCount', { count: profile?.reportsCount ?? 0 })}
            </Text>
          </div>
        </div>
      </Card>

      <Button label={t('settings.title')} variant="secondary" onClick={() => router.push('/settings')} />

      <SectionHeader title={t('profile.myReports')} />
      {reportsQuery.isLoading ? <LoadingList rows={2} /> : null}
      {reportsQuery.data && reportsQuery.data.reports.length === 0 ? (
        <EmptyState title={t('empty.reports')} />
      ) : null}
      <div className="flex flex-col gap-md">
        {(reportsQuery.data?.reports ?? []).slice(0, 20).map((report) => (
          <FeedItemCard key={report.id} item={report} onOpen={(id) => router.push(`/reports/${id}`)} />
        ))}
      </div>

      <SectionHeader title={t('home.favorites')} />
      {favoritesQuery.data && favoritesQuery.data.favorites.length === 0 ? (
        <EmptyState title={t('empty.favorites')} />
      ) : null}
      <ul className="flex flex-col gap-sm">
        {(favoritesQuery.data?.favorites ?? []).map((favorite) => (
          <li key={favorite.id}>
            <Card
              onClick={
                favorite.stopId
                  ? () => router.push(`/stop/${encodeURIComponent(favorite.stopId as string)}`)
                  : undefined
              }
              ariaLabel={favorite.label}
            >
              <Text variant="body" as="span">
                {favorite.label}
              </Text>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
