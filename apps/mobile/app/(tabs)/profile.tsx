import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFavorites, useMyReports } from '../../src/api/hooks.js';
import { useSignOut } from '../../src/auth/useAuth.js';
import { FeedItemCard } from '../../src/components/ReportCard.js';
import { Badge, Button, Card, Text } from '../../src/components/primitives.js';
import { EmptyState, LoadingList, SectionHeader } from '../../src/components/states.js';
import { t } from '../../src/i18n/index.js';
import { useSessionStore } from '../../src/state/session.store.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Profil (§20/§26).
 *
 * Die Reputation wird bewusst NICHT als Punktestand angezeigt, sondern nur
 * als grobe Stufe — kein sozialer Wettbewerb, der zu Falschmeldungen anreizt.
 */
export default function ProfileScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const profile = useSessionStore((state) => state.profile);
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const signOut = useSignOut();

  const reportsQuery = useMyReports();
  const favoritesQuery = useFavorites();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}>
        <Text variant="title1" accessibilityRole="header">
          {t('profile.title')}
        </Text>

        {!signedIn ? (
          <Card style={{ marginTop: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.md }}>
              <Text variant="title3">{t('profile.guest')}</Text>
              <Text variant="callout" color="textSecondary">
                {t('profile.guestBody')}
              </Text>
              <Button label={t('profile.signIn')} onPress={() => router.push('/login')} />
            </View>
          </Card>
        ) : (
          <Card style={{ marginTop: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="title3">{profile?.alias ?? '—'}</Text>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                {profile ? (
                  <>
                    <Badge
                      label={t(`profile.tier.${profile.reputationTier}`)}
                      color={theme.colors.brand}
                      background={theme.colors.brandSubtle}
                    />
                    <Badge label={t('profile.reportsCount', { count: profile.reportsCount })} />
                  </>
                ) : null}
              </View>
            </View>
          </Card>
        )}

        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
          <Button
            label={t('profile.settings')}
            variant="secondary"
            onPress={() => router.push('/settings')}
          />
          {signedIn ? (
            <Button label={t('profile.signOut')} variant="ghost" onPress={() => void signOut()} />
          ) : null}
        </View>

        {signedIn ? (
          <>
            <SectionHeader title={t('home.favorites')} />
            {favoritesQuery.isLoading ? <LoadingList rows={1} /> : null}
            {favoritesQuery.data?.favorites.length === 0 ? (
              <EmptyState title={t('empty.favorites')} />
            ) : null}
            <View style={{ gap: theme.spacing.sm }}>
              {(favoritesQuery.data?.favorites ?? []).map((favorite) => (
                <Card
                  key={favorite.id}
                  onPress={() =>
                    favorite.stopId
                      ? router.push(`/stop/${encodeURIComponent(favorite.stopId)}`)
                      : undefined
                  }
                >
                  <Text variant="bodyStrong">{favorite.label}</Text>
                </Card>
              ))}
            </View>

            <SectionHeader title={t('profile.myReports')} />
            {reportsQuery.isLoading ? <LoadingList rows={2} /> : null}
            {reportsQuery.data?.reports.length === 0 ? (
              <EmptyState title={t('empty.reports')} />
            ) : null}
            <View style={{ gap: theme.spacing.md }}>
              {(reportsQuery.data?.reports ?? []).map((report) => (
                <FeedItemCard key={report.id} item={report} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
