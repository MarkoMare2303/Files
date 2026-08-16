import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import { ApiError } from '../api/client.js';
import { t } from '../i18n/index.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Button, Card, Skeleton, Text } from './primitives.js';

/**
 * Zustände für Laden, Leere und Fehler (§30/§44).
 *
 * Fehlertexte kommen bevorzugt vom Server (bereits übersetzt und für
 * Endnutzer formuliert). Nur wenn keiner vorliegt, greift ein generischer Text.
 */

export function LoadingList({ rows = 3 }: { rows?: number }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }}>
      {Array.from({ length: rows }, (_, index) => (
        <Card key={index}>
          <View style={{ gap: theme.spacing.sm }}>
            <Skeleton height={18} width="60%" />
            <Skeleton height={14} width="85%" />
            <Skeleton height={14} width="40%" />
          </View>
        </Card>
      ))}
    </View>
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
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xxxl }}>
      <Text variant="title3" color="textSecondary" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textTertiary" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Button label={action.label} onPress={action.onPress} variant="secondary" fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const message =
    error instanceof ApiError ? error.userMessage : t('error.generic');

  return (
    <Card style={{ backgroundColor: theme.colors.dangerSubtle, borderColor: theme.colors.danger }}>
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="bodyStrong" color="textPrimary">
          {message}
        </Text>
        {onRetry ? (
          <Button label={t('common.retry')} onPress={onRetry} variant="secondary" fullWidth={false} />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Hinweisleiste, wenn Daten aus dem Cache stammen oder Echtzeitdaten fehlen.
 * Ehrliche Kommunikation statt stiller Halbwahrheiten (§44).
 */
export function DataNotice({ message }: { message: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.warningSubtle,
      }}
    >
      <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.sm,
        marginTop: theme.spacing.lg,
      }}
    >
      <Text variant="title3" accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}
