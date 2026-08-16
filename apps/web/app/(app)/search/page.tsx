'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useSearch } from '../../../src/api/hooks';
import { Card, Text } from '../../../src/components/primitives';
import { EmptyState, ErrorState, LoadingList } from '../../../src/components/states';
import { t } from '../../../src/i18n/index';

/**
 * Suche nach Haltestellen und Linien (§12).
 *
 * Der Eingabewert wird um 250 ms entprellt: eine Anfrage pro Tastendruck
 * würde die API fluten und die Liste flackern lassen.
 */
export default function SearchPage(): React.JSX.Element {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(handle);
  }, [term]);

  const query = useSearch(debounced);

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="title1" as="h1">
        {t('manual.title')}
      </Text>

      <label className="flex flex-col gap-sm">
        <span className="sr-only">{t('manual.searchStop')}</span>
        <input
          type="search"
          value={term}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t('home.searchPlaceholder')}
          onChange={(event) => setTerm(event.target.value)}
          data-testid="search-input"
          className="min-h-[48px] w-full rounded-lg border border-border bg-surface px-lg text-[16px] text-text-primary placeholder:text-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        />
      </label>

      {query.isLoading && debounced.length >= 2 ? <LoadingList rows={4} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}

      {query.data && query.data.results.length === 0 ? (
        <EmptyState title={t('error.notFound')} />
      ) : null}

      <ul className="flex flex-col gap-sm">
        {(query.data?.results ?? []).map((result) => (
          <li key={`${result.kind}:${result.id}`}>
            <Card
              onClick={() =>
                router.push(
                  result.kind === 'STOP'
                    ? `/stop/${encodeURIComponent(result.id)}`
                    : `/reports?routeId=${encodeURIComponent(result.id)}`,
                )
              }
              ariaLabel={result.name}
            >
              <div className="flex flex-col gap-xxs">
                <Text variant="bodyStrong" as="span">
                  {result.name}
                </Text>
                {result.subtitle ? (
                  <Text variant="footnote" color="textTertiary" as="span">
                    {result.subtitle}
                  </Text>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
