'use client';

import React, { type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { t } from '../i18n/index';
import { Button, Card, Skeleton, Text } from './primitives';

/**
 * Zustände für Laden, Leere und Fehler (§30/§44).
 *
 * Fehlertexte kommen bevorzugt vom Server (bereits übersetzt und für
 * Endnutzer formuliert). Nur wenn keiner vorliegt, greift ein generischer Text.
 */

export function LoadingList({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-md" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Card key={index}>
          <div className="flex flex-col gap-sm">
            <Skeleton height={18} width="60%" />
            <Skeleton height={14} width="85%" />
            <Skeleton height={14} width="40%" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-sm py-xxxl text-center">
      <Text variant="title3" color="textSecondary">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textTertiary">
          {body}
        </Text>
      ) : null}
      {action ? (
        <div className="mt-md">
          <Button label={action.label} onClick={action.onPress} variant="secondary" fullWidth={false} />
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): React.JSX.Element {
  const message = error instanceof ApiError ? error.userMessage : t('error.generic');

  return (
    <Card className="border-danger bg-danger-subtle">
      <div className="flex flex-col gap-md" role="alert">
        <Text variant="bodyStrong">{message}</Text>
        {onRetry ? (
          <Button label={t('common.retry')} onClick={onRetry} variant="secondary" fullWidth={false} />
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Hinweisleiste, wenn Daten aus dem Cache stammen oder Echtzeitdaten fehlen.
 * Ehrliche Kommunikation statt stiller Halbwahrheiten (§44).
 */
export function DataNotice({ message }: { message: string }): React.JSX.Element {
  return (
    <div role="status" className="flex gap-sm rounded-md bg-warning-subtle p-md">
      <Text variant="footnote" color="textSecondary" className="flex-1">
        {message}
      </Text>
    </div>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-sm mt-lg flex items-center justify-between gap-md">
      <Text variant="title3" as="h2">
        {title}
      </Text>
      {action}
    </div>
  );
}
