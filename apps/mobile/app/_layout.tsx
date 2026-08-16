import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthBootstrap } from '../src/auth/useAuth.js';
import { setInstallId } from '../src/api/client.js';
import { setLocale } from '../src/i18n/index.js';
import { useOfflineQueue } from '../src/state/offline-queue.store.js';
import { useSessionStore } from '../src/state/session.store.js';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider.js';

/**
 * Wurzel-Layout.
 *
 * Verantwortlich für: Query-Client, Theme, Sprache, Installations-ID,
 * Onboarding-Weiche und das Leeren der Offline-Warteschlange.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Im ÖV ist die Verbindung unzuverlässig — lieber einmal weniger neu
        // laden und zwischengespeicherte Daten zeigen (§39).
        retry: 1,
        staleTime: 30_000,
        gcTime: 60 * 60_000,
        refetchOnWindowFocus: false,
        networkMode: 'offlineFirst',
      },
      mutations: { retry: 0, networkMode: 'offlineFirst' },
    },
  });
}

/** Erzeugt eine app-eigene Installations-ID (kein Hardware-Identifier). */
function generateInstallId(): string {
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

function RootNavigator(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const { ready } = useAuthBootstrap();

  const onboardingCompleted = useSessionStore((state) => state.onboardingCompleted);
  const locale = useSessionStore((state) => state.locale);
  const installId = useSessionStore((state) => state.installId);
  const setStoreInstallId = useSessionStore((state) => state.setInstallId);
  const flush = useOfflineQueue((state) => state.flush);

  useEffect(() => {
    setLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (installId) {
      setInstallId(installId);
      return;
    }
    const generated = generateInstallId();
    setStoreInstallId(generated);
    setInstallId(generated);
  }, [installId, setStoreInstallId]);

  // Beim Start liegen gebliebene Meldungen senden (§39).
  useEffect(() => {
    if (ready) void flush();
  }, [ready, flush]);

  useEffect(() => {
    if (!ready) return;
    const inOnboarding = segments[0] === 'onboarding';
    if (!onboardingCompleted && !inOnboarding) router.replace('/onboarding');
    else if (onboardingCompleted && inOnboarding) router.replace('/');
  }, [ready, onboardingCompleted, segments, router]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTitleStyle: { color: theme.colors.textPrimary },
          headerTintColor: theme.colors.brand,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="login" options={{ presentation: 'modal', title: '' }} />
        <Stack.Screen name="search" options={{ presentation: 'modal', title: '' }} />
        <Stack.Screen name="settings" options={{ title: '' }} />
        <Stack.Screen name="trip/[tripId]" options={{ title: '' }} />
        <Stack.Screen name="stop/[stopId]" options={{ title: '' }} />
      </Stack>
    </>
  );
}

export default function RootLayout(): React.JSX.Element {
  const [queryClient] = useState(createQueryClient);
  const memoClient = useMemo(() => queryClient, [queryClient]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={memoClient}>
          <ThemeProvider>
            <RootNavigator />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
