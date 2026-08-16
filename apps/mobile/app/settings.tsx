import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api/endpoints.js';
import { useSignOut } from '../src/auth/useAuth.js';
import { Button, Card, Divider, Text } from '../src/components/primitives.js';
import { DataNotice, SectionHeader } from '../src/components/states.js';
import { LOCALE_LABELS, SUPPORTED_LOCALES, t, type Locale } from '../src/i18n/index.js';
import { useSessionStore } from '../src/state/session.store.js';
import { useTheme } from '../src/theme/ThemeProvider.js';

/**
 * Einstellungen inklusive Datenschutzsteuerung (§23/§24).
 *
 * Einwilligungen sind hier jederzeit widerrufbar; Datenexport und
 * Kontolöschung sind direkt erreichbar, nicht in Untermenüs versteckt.
 */
export default function SettingsScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOut = useSignOut();

  const settings = useSessionStore((state) => state.settings);
  const setSettings = useSessionStore((state) => state.setSettings);
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const locale = useSessionStore((state) => state.locale);
  const setLocaleStore = useSessionStore((state) => state.setLocale);
  const themePreference = useSessionStore((state) => state.themePreference);
  const setThemePreference = useSessionStore((state) => state.setThemePreference);

  const [busy, setBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  async function patch(update: Parameters<typeof api.updateSettings>[0]): Promise<void> {
    if (!signedIn) return;
    setBusy(true);
    try {
      const result = await api.updateSettings(update);
      setSettings(result.settings);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(): void {
    Alert.alert(t('settings.deleteAccount'), t('settings.deleteAccountConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteAccountAction'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await api.deleteAccount();
            await signOut();
            queryClient.clear();
            router.replace('/');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 80 }}>
        <Text variant="title1" accessibilityRole="header">
          {t('settings.title')}
        </Text>

        <SectionHeader title={t('settings.appearance')} />
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            {(['SYSTEM', 'LIGHT', 'DARK'] as const).map((option) => (
              <Row
                key={option}
                label={t(`settings.theme.${option}`)}
                value={themePreference === option}
                onChange={() => {
                  setThemePreference(option);
                  void patch({ theme: option });
                }}
              />
            ))}
          </View>
        </Card>

        <SectionHeader title={t('settings.language')} />
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            {SUPPORTED_LOCALES.map((option: Locale) => (
              <Row
                key={option}
                label={LOCALE_LABELS[option]}
                value={locale === option}
                onChange={() => {
                  setLocaleStore(option);
                  void patch({ locale: option });
                }}
              />
            ))}
          </View>
        </Card>

        {signedIn && settings ? (
          <>
            <SectionHeader title={t('settings.notifications')} />
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                {(
                  [
                    'officialDisruptions',
                    'delays',
                    'highOccupancy',
                    'vehicleIssues',
                    'safety',
                    'connectionAtRisk',
                    'communityReports',
                  ] as const
                ).map((key) => (
                  <Row
                    key={key}
                    label={t(`settings.notify.${key}`)}
                    value={settings.notifications[key]}
                    disabled={busy}
                    onChange={(next) => void patch({ notifications: { [key]: next } })}
                  />
                ))}
              </View>
            </Card>

            <SectionHeader title={t('settings.privacy')} />
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                <Row
                  label={t('settings.autoTripDetection')}
                  value={settings.autoTripDetection}
                  disabled={busy}
                  onChange={(next) => void patch({ autoTripDetection: next })}
                />
                <Divider />
                <Row
                  label={t('settings.autoFollow')}
                  value={settings.autoFollowDetectedTrip}
                  disabled={busy}
                  onChange={(next) => void patch({ autoFollowDetectedTrip: next })}
                />
                <Divider />
                <Row
                  label={t('settings.backgroundLocation')}
                  hint={t('settings.backgroundLocationHint')}
                  value={settings.backgroundLocationConsent}
                  disabled={busy}
                  onChange={(next) => void patch({ backgroundLocationConsent: next })}
                />
                <Divider />
                <Row
                  label={t('settings.analytics')}
                  hint={t('settings.analyticsHint')}
                  value={settings.analyticsConsent}
                  disabled={busy}
                  onChange={(next) => void patch({ analyticsConsent: next })}
                />
                <Divider />
                <Row
                  label={t('settings.reducedMotion')}
                  value={settings.reducedMotion}
                  disabled={busy}
                  onChange={(next) => void patch({ reducedMotion: next })}
                />
              </View>
            </Card>

            <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}>
              {exportNote ? <DataNotice message={exportNote} /> : null}
              <Button
                label={t('settings.dataExport')}
                variant="secondary"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    const data = await api.exportData();
                    const count = Object.keys(data).length;
                    setExportNote(`Export erstellt (${count} Datenbereiche).`);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Button label={t('settings.deleteAccount')} variant="danger" onPress={confirmDelete} />
            </View>
          </>
        ) : (
          <View style={{ marginTop: theme.spacing.xl }}>
            <DataNotice message={t('profile.guestBody')} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" color="textTertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: theme.colors.brand, false: theme.colors.borderStrong }}
      />
    </View>
  );
}
