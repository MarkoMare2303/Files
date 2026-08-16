import { relativeTimeDe, trustTier } from '@swissov/shared';
import type { FeedItem, Report } from '@swissov/types';
import React from 'react';
import { Pressable, View } from 'react-native';
import { pick, t } from '../i18n/index.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Badge, Card, Text } from './primitives.js';

/**
 * Darstellung einer Meldung (§14).
 *
 * Die Quellenkennzeichnung ist nicht dekorativ, sondern strukturell: offizielle
 * Meldungen und Community-Meldungen sehen unterschiedlich aus, tragen ein
 * eigenes Label und lassen sich nicht verwechseln (§7).
 */

export function FeedItemCard({
  item,
  onVote,
  onFlag,
  onPress,
}: {
  item: FeedItem;
  onVote?: (reportId: string, vote: 1 | -1) => void;
  onFlag?: (reportId: string) => void;
  onPress?: () => void;
}): React.JSX.Element {
  if (item.source === 'OFFICIAL') return <OfficialAlertCard item={item} />;
  return <CommunityReportCard report={item} onVote={onVote} onFlag={onFlag} onPress={onPress} />;
}

function OfficialAlertCard({
  item,
}: {
  item: Extract<FeedItem, { source: 'OFFICIAL' }>;
}): React.JSX.Element {
  const theme = useTheme();
  const severityColor =
    item.severity === 'SEVERE'
      ? theme.colors.danger
      : item.severity === 'WARNING'
        ? theme.colors.warning
        : theme.colors.official;

  return (
    <Card
      style={{
        borderLeftWidth: 4,
        borderLeftColor: severityColor,
        backgroundColor: theme.colors.officialSubtle,
      }}
    >
      <View style={{ gap: theme.spacing.sm }}>
        <Badge
          label={t('common.official')}
          color={theme.colors.onOfficial}
          background={theme.colors.official}
        />
        <Text variant="bodyStrong">{pick(item.header)}</Text>
        {item.description ? (
          <Text variant="callout" color="textSecondary" numberOfLines={4}>
            {pick(item.description)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function CommunityReportCard({
  report,
  onVote,
  onFlag,
  onPress,
}: {
  report: Report;
  onVote?: (reportId: string, vote: 1 | -1) => void;
  onFlag?: (reportId: string) => void;
  onPress?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const tier = trustTier(report.confidence);
  const tierLabel =
    tier === 'CONFIRMED'
      ? t('report.trust.confirmed')
      : tier === 'LIKELY'
        ? t('report.trust.likely')
        : t('report.trust.low');
  const tierColor =
    tier === 'CONFIRMED'
      ? theme.colors.success
      : tier === 'LIKELY'
        ? theme.colors.info
        : theme.colors.textTertiary;

  const confirmations =
    report.upvotes === 1
      ? t('report.confirmationsOne')
      : t('report.confirmations', { count: report.upvotes });

  return (
    <Card onPress={onPress} accessibilityLabel={pick(report.categoryLabel)}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.md,
              backgroundColor: `${report.categoryColor}22`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: report.categoryColor,
              }}
            />
          </View>

          <View style={{ flex: 1, gap: theme.spacing.xxs }}>
            <Text variant="bodyStrong">{pick(report.categoryLabel)}</Text>
            <Text variant="footnote" color="textTertiary">
              {relativeTimeDe(new Date(report.createdAt))}
              {report.upvotes > 0 ? ` · ${confirmations}` : ''}
            </Text>
          </View>

          <Badge label={tierLabel} color={tierColor} />
        </View>

        {report.message ? (
          <Text variant="callout" color="textSecondary">
            {report.message}
          </Text>
        ) : null}

        {report.stopName || report.nextStopName ? (
          <Text variant="footnote" color="textTertiary">
            {report.nextStopName ?? report.stopName}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Badge
            label={t('common.community')}
            color={theme.colors.community}
            background={theme.colors.communitySubtle}
          />
          {report.isMine ? <Badge label={t('report.mine')} /> : null}
          <View style={{ flex: 1 }} />

          {!report.isMine && onVote ? (
            <>
              <VoteButton
                label={t('report.confirm')}
                active={report.myVote === 1}
                onPress={() => onVote(report.id, 1)}
                activeColor={theme.colors.success}
              />
              <VoteButton
                label={t('report.outdated')}
                active={report.myVote === -1}
                onPress={() => onVote(report.id, -1)}
                activeColor={theme.colors.danger}
              />
            </>
          ) : null}
        </View>

        {!report.isMine && onFlag ? (
          <Pressable
            onPress={() => onFlag(report.id)}
            accessibilityRole="button"
            accessibilityLabel={t('report.flag')}
            hitSlop={8}
          >
            <Text variant="caption" color="textTertiary">
              {t('report.flag')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function VoteButton({
  label,
  active,
  onPress,
  activeColor,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeColor: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: theme.spacing.md,
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: active ? activeColor : theme.colors.border,
        backgroundColor: active ? `${activeColor}1A` : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text variant="caption" style={{ color: active ? activeColor : theme.colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}
