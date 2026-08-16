'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { useAuthBootstrap } from '../auth/useAuth';
import { resolveLocale, setLocale } from '../i18n/index';
import { ensureAppleWebAppMeta } from '../pwa/appleWebAppMeta';
import { startOfflineQueueWatcher } from '../state/offline-queue.store';
import { useSessionStore } from '../state/session.store';
import { ThemeProvider } from '../theme/ThemeProvider';
import { UpdateBanner } from './UpdateBanner';

/**
 * Anwendungsweite Provider.
 *
 * Reihenfolge ist wichtig: Query zuerst (der Auth-Bootstrap nutzt ihn), dann
 * Theme, dann der Rest.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Im Browser wechselt man ständig den Tab. Kehrt man zurück, müssen
        // Abfahrtszeiten stimmen — nativ gab es diesen Fall nicht.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // Offline oder fachlich abgelehnt: erneutes Versuchen bringt nichts.
          if (error instanceof ApiError) {
            if (error.isOffline) return false;
            if (error.status >= 400 && error.status < 500) return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

function Bootstrap({ children }: { children: React.ReactNode }): React.JSX.Element {
  useAuthBootstrap();
  const setLocaleStore = useSessionStore((state) => state.setLocale);
  const storedLocale = useSessionStore((state) => state.locale);
  const ensureInstallId = useSessionStore((state) => state.ensureInstallId);

  // Sprache: gespeicherte Wahl schlägt Browsersprache.
  useEffect(() => {
    const preferred = storedLocale ?? resolveLocale([...navigator.languages]);
    setLocale(preferred);
    setLocaleStore(preferred);
    document.documentElement.lang = preferred;
  }, [setLocaleStore, storedLocale]);

  useEffect(() => {
    ensureInstallId();
    ensureAppleWebAppMeta();
    return startOfflineQueueWatcher();
  }, [ensureInstallId]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Pro Browser-Sitzung genau ein Client — nicht bei jedem Rendern ein neuer.
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Bootstrap>
          <UpdateBanner />
          {children}
        </Bootstrap>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
