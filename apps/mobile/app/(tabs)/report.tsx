import type { ReportCategory } from '@swissov/types';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client.js';
import { api } from '../../src/api/endpoints.js';
import { queryKeys, useAppConfig } from '../../src/api/hooks.js';
import { Badge, Button, Card, Text } from '../../src/components/primitives.js';
import { DataNotice, ErrorState, LoadingList } from '../../src/components/states.js';
import { pick, t } from '../../src/i18n/index.js';
import { useLocation } from '../../src/location/useLocation.js';
import { useOfflineQueue } from '../../src/state/offline-queue.store.js';
import { useSessionStore } from '../../src/state/session.store.js';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Melden (§15/§69).
 *
 * Ziel: unter fünf Sekunden von „App offen" zu „Meldung gesendet". Deshalb
 * ein Griff — Kategorie antippen, fertig. Der Freitext ist optional und
 * kommt erst nach der Auswahl.
 *
 * Der gesamte Kontext (Fahrt, Linie, Halt) wird serverseitig aus der aktiven
 * Fahrt-Sitzung abgeleitet; die App schickt nur Kategorie und Position.
 */
function generateClientReportId(): string {
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

export default function ReportScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const configQuery = useAppConfig();
  const activeTrip = useSessionStore((state) => state.activeTrip);
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const { latest } = useLocation();
  const enqueue = useOfflineQueue((state) => state.enqueue);

  const [selected, setSelected] = useState<ReportCategory | null>(null);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'queued'>('idle');
  const [error, setError] = useState<unknown>(null);

  const categories = configQuery.data?.categories ?? [];
  const maxLength = configQuery.data?.limits.messageMaxLength ?? 280;

  const grouped = useMemo(() => {
    const groups = new Map<string, ReportCategory[]>();
    for (const category of categories) {
      // Kategorien, die zwingend eine Fahrt brauchen, ohne aktive Fahrt
      // ausblenden — sie wären ohnehin nicht absendbar (§55).
      if (category.requiresTrip && !activeTrip) continue;
      const list = groups.get(category.group) ?? [];
      list.push(category);
      groups.set(category.group, list);
    }
    return [...groups.entries()];
  }, [categories, activeTrip]);

  async function submit(category: ReportCategory): Promise<void> {
    if (!signedIn) {
      router.push('/login');
      return;
    }

    setStatus('sending');
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const clientReportId = generateClientReportId();
    const input = {
      categoryKey: category.key,
      ...(activeTrip ? { tripSessionId: activeTrip.id } : {}),
      ...(latest ? { lat: latest.lat, lon: latest.lon, accuracy: latest.accuracy, speed: latest.speed } : {}),
      ...(message.trim().length > 0 ? { message: message.trim() } : {}),
      clientReportId,
      observedAt: new Date().toISOString(),
    };

    try {
      await api.createReport(input);
      setStatus('sent');
      setMessage('');
      setSelected(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({ queryKey: ['trip-reports'] });
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.isOffline) {
        // Funkloch: lokal einreihen und später senden (§39).
        enqueue(input, clientReportId);
        setStatus('queued');
        setSelected(null);
        setMessage('');
        return;
      }
      setStatus('idle');
      setError(submitError);
    }
  }

  if (configQuery.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.lg }}>
          <LoadingList rows={4} />
        </View>
      </SafeAreaView>
    );
  }

  if (configQuery.isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.lg }}>
          <ErrorState error={configQuery.error} onRetry={() => void configQuery.refetch()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 140 }}>
        <Text variant="title1" accessibilityRole="header">
          {t('report.createTitle')}
        </Text>

        {!signedIn ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <DataNotice message={t('report.needsAccount')} />
          </View>
        ) : null}

        {!activeTrip ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                <Text variant="callout" color="textSecondary">
                  {t('report.needsTrip')}
                </Text>
                <Button
                  label={t('detection.manualButton')}
                  variant="secondary"
                  onPress={() => router.push('/trips')}
                />
              </View>
            </Card>
          </View>
        ) : null}

        {status === 'sent' ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <Card style={{ backgroundColor: theme.colors.successSubtle }}>
              <Text variant="bodyStrong">{t('report.success')}</Text>
            </Card>
          </View>
        ) : null}

        {status === 'queued' ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <DataNotice message={t('report.successOffline')} />
          </View>
        ) : null}

        {error ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <ErrorState error={error} />
          </View>
        ) : null}

        {selected ? (
          <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: selected.color,
                    }}
                  />
                  <Text variant="title3">{pick(selected.label)}</Text>
                </View>
                {selected.description ? (
                  <Text variant="footnote" color="textSecondary">
                    {pick(selected.description)}
                  </Text>
                ) : null}

                <Text variant="caption" color="textTertiary">
                  {t('report.optionalMessage')}
                </Text>
                <TextInput
                  value={message}
                  onChangeText={(value) => setMessage(value.slice(0, maxLength))}
                  placeholder={t('report.messagePlaceholder')}
                  placeholderTextColor={theme.colors.textTertiary}
                  multiline
                  maxLength={maxLength}
                  accessibilityLabel={t('report.optionalMessage')}
                  style={{
                    minHeight: 72,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surfaceSunken,
                    color: theme.colors.textPrimary,
                    padding: theme.spacing.md,
                    textAlignVertical: 'top',
                  }}
                />

                <Button
                  label={status === 'sending' ? t('report.submitting') : t('report.submit')}
                  loading={status === 'sending'}
                  onPress={() => void submit(selected)}
                />
                <Button
                  label={t('common.cancel')}
                  variant="ghost"
                  onPress={() => setSelected(null)}
                />
              </View>
            </Card>
          </View>
        ) : (
          grouped.map(([group, items]) => (
            <View key={group} style={{ marginTop: theme.spacing.xl }}>
              <Text variant="caption" color="textTertiary" style={{ marginBottom: theme.spacing.sm }}>
                {group}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {items.map((category) => (
                  <Pressable
                    key={category.key}
                    accessibilityRole="button"
                    accessibilityLabel={pick(category.label)}
                    // Ein Tap sendet direkt — das ist der Fünf-Sekunden-Pfad (§69).
                    onPress={() => void submit(category)}
                    onLongPress={() => setSelected(category)}
                    style={({ pressed }) => ({
                      minHeight: theme.minTouchTarget,
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.md,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface,
                      borderWidth: 1,
                      borderLeftWidth: 4,
                      borderColor: theme.colors.border,
                      borderLeftColor: category.color,
                      opacity: pressed ? 0.8 : 1,
                      flexGrow: 1,
                      minWidth: '46%',
                    })}
                  >
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {pick(category.label)}
                    </Text>
                    {category.severity === 'HIGH' ? (
                      <View style={{ marginTop: theme.spacing.xs, alignSelf: 'flex-start' }}>
                        <Badge
                          label={t(`report.scope.${category.defaultScope}`)}
                          color={theme.colors.danger}
                          background={theme.colors.dangerSubtle}
                        />
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
