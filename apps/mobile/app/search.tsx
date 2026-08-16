import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api/endpoints.js';
import { queryKeys } from '../src/api/hooks.js';
import { Badge, Card, Text } from '../src/components/primitives.js';
import { EmptyState, ErrorState, LoadingList, SectionHeader } from '../src/components/states.js';
import { t } from '../src/i18n/index.js';
import { useTheme } from '../src/theme/ThemeProvider.js';

/**
 * Globale Suche (§27).
 *
 * Debounced, damit jede Tastatureingabe keine Anfrage auslöst. Die letzten
 * Suchbegriffe liegen nur lokal im Speicher der Sitzung — es entsteht keine
 * serverseitige Suchhistorie (§23).
 */
const DEBOUNCE_MS = 250;

export default function SearchScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const query = useQuery({
    queryKey: queryKeys.search(debounced),
    enabled: debounced.length >= 2,
    queryFn: () => api.search(debounced),
    staleTime: 5 * 60_000,
  });

  const remember = (term: string): void => {
    setRecent((previous) => [term, ...previous.filter((item) => item !== term)].slice(0, 8));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['bottom']}>
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={t('search.placeholder')}
          placeholderTextColor={theme.colors.textTertiary}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('search.placeholder')}
          style={{
            minHeight: theme.minTouchTarget,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.lg,
            color: theme.colors.textPrimary,
            fontSize: theme.typography.body.fontSize,
          }}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: 80 }}>
        {debounced.length > 0 && debounced.length < 2 ? (
          <Text variant="footnote" color="textTertiary">
            {t('search.minChars')}
          </Text>
        ) : null}

        {query.isLoading && debounced.length >= 2 ? <LoadingList rows={3} /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data?.results.length === 0 ? <EmptyState title={t('search.noResults')} /> : null}

        <View style={{ gap: theme.spacing.sm }}>
          {(query.data?.results ?? []).map((result) => (
            <Card
              key={`${result.kind}-${result.id}`}
              accessibilityLabel={result.name}
              onPress={() => {
                remember(result.name);
                if (result.kind === 'STOP') {
                  router.push(`/stop/${encodeURIComponent(result.id)}`);
                }
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Badge
                  label={result.kind === 'STOP' ? '◉' : (result.name || '—')}
                  color={theme.colors.textOnBrand}
                  background={
                    result.vehicleType
                      ? (theme.vehicleColors[result.vehicleType] ?? theme.colors.brand)
                      : theme.colors.brand
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {result.name}
                  </Text>
                  {result.subtitle ? (
                    <Text variant="footnote" color="textTertiary" numberOfLines={1}>
                      {result.subtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>
          ))}
        </View>

        {debounced.length < 2 && recent.length > 0 ? (
          <>
            <SectionHeader title={t('search.recent')} />
            <View style={{ gap: theme.spacing.sm }}>
              {recent.map((term) => (
                <Pressable
                  key={term}
                  onPress={() => setInput(term)}
                  accessibilityRole="button"
                  accessibilityLabel={term}
                  style={{ paddingVertical: theme.spacing.md }}
                >
                  <Text variant="body" color="textSecondary">
                    {term}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
