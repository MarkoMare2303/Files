'use client';

import React, { useEffect, useState } from 'react';
import { t } from '../i18n/index';
import { useOfflineQueue } from '../state/offline-queue.store';
import { BottomNav } from './BottomNav';
import { InstallHint } from './InstallHint';
import { Text } from './primitives';

/**
 * Gerüst der App-Ansichten: Statusleisten oben, Navigation unten.
 *
 * Der Offline-Hinweis ist bewusst dauerhaft sichtbar, solange keine
 * Verbindung besteht. Nichts ist ärgerlicher, als eine Meldung zu tippen und
 * erst beim Senden zu erfahren, dass man kein Netz hat.
 */
export function AppShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const online = useOnlineStatus();
  const queued = useOfflineQueue((state) => state.items.length);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {!online ? (
        <div
          role="status"
          data-testid="offline-banner"
          className="safe-top sticky top-0 z-30 bg-warning-subtle px-lg py-sm text-center"
        >
          <Text variant="footnote" color="textSecondary" as="span">
            {t('pwa.offlineBadge')}
            {queued > 0
              ? ` · ${queued === 1 ? t('pwa.queuedOne') : t('pwa.queued', { count: queued })}`
              : ''}
          </Text>
        </div>
      ) : null}

      <main id="main" className="app-scroll mx-auto w-full max-w-2xl flex-1 px-lg pt-lg">
        {children}
      </main>

      <InstallHint />
      <BottomNav />
    </div>
  );
}

/**
 * `navigator.onLine` plus die beiden Ereignisse.
 *
 * Bewusst optimistisch initialisiert: bei der ersten Darstellung auf dem
 * Server gibt es kein `navigator`, und ein fälschlich angezeigtes „Offline"
 * wäre schlimmer als ein verspätetes.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
