'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { api, type UserSettingsPatch } from '../../../src/api/endpoints';
import { useSignOut } from '../../../src/auth/useAuth';
import { Button, Card, Divider, Switch, Text, cx } from '../../../src/components/primitives';
import { DataNotice, SectionHeader } from '../../../src/components/states';
import { LOCALE_LABELS, SUPPORTED_LOCALES, setLocale, t, type Locale } from '../../../src/i18n/index';
import { useInstallPrompt } from '../../../src/pwa/useInstallPrompt';
import { usePushSubscription } from '../../../src/push/usePushSubscription';
import { useSessionStore } from '../../../src/state/session.store';

/**
 * Einstellungen inklusive Datenschutzsteuerung (§23/§24).
 *
 * Einwilligungen sind hier jederzeit widerrufbar; Datenexport und
 * Kontolöschung sind direkt erreichbar, nicht in Untermenüs versteckt.
 *
 * Web-spezifisch: Die Hintergrundortung fehlt, weil der Browser sie nicht
 * kann. Statt eines Schalters, der nichts tut, steht dort die Erklärung.
 */
export default function SettingsPage(): React.JSX.Element {
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

  const push = usePushSubscription();
  const install = useInstallPrompt();

  const [busy, setBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function patch(update: UserSettingsPatch): Promise<void> {
    if (!signedIn) return;
    setBusy(true);
    try {
      const result = await api.updateSettings(update);
      setSettings(result.settings);
    } finally {
      setBusy(false);
    }
  }

  function chooseLocale(next: Locale): void {
    setLocale(next);
    setLocaleStore(next);
    document.documentElement.lang = next;
    void patch({ locale: next });
  }

  async function exportData(): Promise<void> {
    setBusy(true);
    try {
      const data = await api.exportData();
      // Der Download läuft rein clientseitig — die Daten verlassen den
      // Browser nicht ein zweites Mal.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `oev-live-daten-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportNote(t('settings.dataExportDone'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(): Promise<void> {
    setBusy(true);
    try {
      await api.deleteAccount();
      await signOut();
      queryClient.clear();
      router.push('/');
    } finally {
      setBusy(false);
    }
  }

  const notifications = settings?.notifications;

  return (
    <div className="flex flex-col gap-lg" aria-busy={busy}>
      <Text variant="title1" as="h1">
        {t('settings.title')}
      </Text>

      {/* --- Darstellung ---------------------------------------------------- */}
      <SectionHeader title={t('settings.appearance')} />
      <Card>
        <fieldset className="flex flex-col gap-sm">
          <legend className="sr-only">{t('settings.appearance')}</legend>
          <div className="flex gap-sm">
            {(['SYSTEM', 'LIGHT', 'DARK'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={themePreference === option}
                onClick={() => {
                  setThemePreference(option);
                  void patch({ theme: option });
                }}
                className={cx(
                  'min-h-[44px] flex-1 rounded-md border px-md text-[15px] font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  themePreference === option
                    ? 'border-brand bg-brand-subtle text-brand'
                    : 'border-border bg-surface text-text-secondary hover:bg-surface-sunken',
                )}
              >
                {t(`settings.theme.${option}` as 'settings.theme.SYSTEM')}
              </button>
            ))}
          </div>
        </fieldset>
      </Card>

      {/* --- Sprache -------------------------------------------------------- */}
      <SectionHeader title={t('settings.language')} />
      <Card>
        <div className="flex flex-wrap gap-sm">
          {SUPPORTED_LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={locale === option}
              onClick={() => chooseLocale(option)}
              className={cx(
                'min-h-[44px] rounded-md border px-lg text-[15px] font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                locale === option
                  ? 'border-brand bg-brand-subtle text-brand'
                  : 'border-border bg-surface text-text-secondary hover:bg-surface-sunken',
              )}
            >
              {LOCALE_LABELS[option]}
            </button>
          ))}
        </div>
      </Card>

      {/* --- Installation --------------------------------------------------- */}
      <SectionHeader title={t('pwa.installTitle')} />
      <Card>
        {install.installed ? (
          <Text variant="callout" color="success">
            {t('pwa.installed')}
          </Text>
        ) : install.method === 'PROMPT' ? (
          <Button label={t('pwa.install')} onClick={() => void install.install()} />
        ) : (
          <ol className="flex list-decimal flex-col gap-xxs pl-lg">
            <li>
              <Text variant="footnote" color="textSecondary" as="span">
                {t('pwa.iosStep1')}
              </Text>
            </li>
            <li>
              <Text variant="footnote" color="textSecondary" as="span">
                {t('pwa.iosStep2')}
              </Text>
            </li>
            <li>
              <Text variant="footnote" color="textSecondary" as="span">
                {t('pwa.iosStep3')}
              </Text>
            </li>
          </ol>
        )}
      </Card>

      {/* --- Benachrichtigungen --------------------------------------------- */}
      <SectionHeader title={t('settings.notifications')} />
      <Card>
        <div className="flex flex-col gap-md">
          {push.blocker ? (
            <DataNotice
              message={
                push.blocker === 'NEEDS_INSTALL_IOS'
                  ? t('push.blocked.needsInstallIos')
                  : push.blocker === 'PERMISSION_DENIED'
                    ? t('push.blocked.permissionDenied')
                    : push.blocker === 'NOT_SIGNED_IN'
                      ? t('push.blocked.notSignedIn')
                      : push.blocker === 'SERVER_DISABLED'
                        ? t('push.blocked.serverDisabled')
                        : t('push.blocked.unsupported')
              }
            />
          ) : push.subscribed ? (
            <>
              <Text variant="callout" color="success">
                {t('push.enabled')}
              </Text>
              <Button
                label={t('push.disable')}
                variant="secondary"
                loading={push.busy}
                onClick={() => void push.unsubscribe()}
              />
            </>
          ) : (
            <Button
              label={t('push.enable')}
              loading={push.busy}
              onClick={() => void push.subscribe()}
              data-testid="enable-push"
            />
          )}

          {notifications ? (
            <>
              <Divider />
              {(
                [
                  ['officialDisruptions', 'settings.notify.officialDisruptions'],
                  ['delays', 'settings.notify.delays'],
                  ['highOccupancy', 'settings.notify.highOccupancy'],
                  ['vehicleIssues', 'settings.notify.vehicleIssues'],
                  ['safety', 'settings.notify.safety'],
                  ['connectionAtRisk', 'settings.notify.connectionAtRisk'],
                  ['communityReports', 'settings.notify.communityReports'],
                ] as const
              ).map(([key, labelKey]) => (
                <Switch
                  key={key}
                  label={t(labelKey)}
                  checked={notifications[key]}
                  disabled={busy || !signedIn}
                  onChange={(value) => void patch({ notifications: { [key]: value } })}
                />
              ))}
            </>
          ) : null}
        </div>
      </Card>

      {/* --- Datenschutz ---------------------------------------------------- */}
      <SectionHeader title={t('settings.privacy')} />
      <Card>
        <div className="flex flex-col gap-sm">
          <Switch
            label={t('settings.autoTripDetection')}
            checked={settings?.autoTripDetection ?? true}
            disabled={busy || !signedIn}
            onChange={(value) => void patch({ autoTripDetection: value })}
          />
          <Switch
            label={t('settings.autoFollow')}
            checked={settings?.autoFollowDetectedTrip ?? false}
            disabled={busy || !signedIn}
            onChange={(value) => void patch({ autoFollowDetectedTrip: value })}
          />
          <Switch
            label={t('settings.analytics')}
            description={t('settings.analyticsHint')}
            checked={settings?.analyticsConsent ?? false}
            disabled={busy || !signedIn}
            onChange={(value) => void patch({ analyticsConsent: value })}
          />
          <Switch
            label={t('settings.reducedMotion')}
            checked={settings?.reducedMotion ?? false}
            disabled={busy || !signedIn}
            onChange={(value) => void patch({ reducedMotion: value })}
          />

          <Divider />
          {/* Kein Schalter für Hintergrundortung: der Browser kann das nicht.
              Ein Schalter ohne Wirkung wäre eine Lüge (§55). */}
          <DataNotice message={t('location.foregroundOnly')} />
        </div>
      </Card>

      {/* --- Daten und Konto ------------------------------------------------ */}
      <SectionHeader title={t('settings.dataExport')} />
      <Card>
        <div className="flex flex-col gap-md">
          <Button
            label={t('settings.dataExport')}
            variant="secondary"
            disabled={!signedIn || busy}
            onClick={() => void exportData()}
          />
          {exportNote ? (
            <Text variant="footnote" color="success">
              {exportNote}
            </Text>
          ) : null}

          <Divider />

          {confirmDelete ? (
            <>
              <Text variant="footnote" color="danger">
                {t('settings.deleteAccountConfirm')}
              </Text>
              <Button
                label={t('settings.deleteAccountAction')}
                variant="danger"
                disabled={busy}
                onClick={() => void deleteAccount()}
              />
              <Button
                label={t('common.cancel')}
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              />
            </>
          ) : (
            <Button
              label={t('settings.deleteAccount')}
              variant="danger"
              disabled={!signedIn || busy}
              onClick={() => setConfirmDelete(true)}
            />
          )}

          {signedIn ? (
            <Button
              label={t('profile.signOut')}
              variant="ghost"
              onClick={() => {
                void signOut().then(() => router.push('/'));
              }}
            />
          ) : (
            <Button label={t('profile.signIn')} onClick={() => router.push('/login')} />
          )}
        </div>
      </Card>
    </div>
  );
}
