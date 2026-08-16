'use client';

import { relativeTimeDe, trustTier } from '@swissov/shared';
import type { FeedItem, Report } from '@swissov/types';
import React from 'react';
import { pick, t } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { SourceBadge } from './SourceBadge';
import { Badge, Text, cx } from './primitives';

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
  onOpen,
}: {
  item: FeedItem;
  onVote?: (reportId: string, vote: 1 | -1) => void;
  onFlag?: (reportId: string) => void;
  onOpen?: (reportId: string) => void;
}): React.JSX.Element {
  if (item.source === 'OFFICIAL') return <OfficialAlertCard item={item} />;
  return <CommunityReportCard report={item} onVote={onVote} onFlag={onFlag} onOpen={onOpen} />;
}

function OfficialAlertCard({
  item,
}: {
  item: Extract<FeedItem, { source: 'OFFICIAL' }>;
}): React.JSX.Element {
  const { colors } = useTheme();
  const severityColor =
    item.severity === 'SEVERE'
      ? colors.danger
      : item.severity === 'WARNING'
        ? colors.warning
        : colors.official;

  return (
    <article
      className="rounded-lg border border-border bg-official-subtle p-lg"
      style={{ borderLeftWidth: 4, borderLeftColor: severityColor }}
      data-source="OFFICIAL"
      data-testid="feed-item"
    >
      <div className="flex flex-col gap-sm">
        <SourceBadge kind="OFFICIAL" className="self-start" />
        <Text variant="bodyStrong" as="h3">
          {pick(item.header)}
        </Text>
        {item.description ? (
          <Text variant="callout" color="textSecondary" className="line-clamp-4">
            {pick(item.description)}
          </Text>
        ) : null}
      </div>
    </article>
  );
}

function CommunityReportCard({
  report,
  onVote,
  onFlag,
  onOpen,
}: {
  report: Report;
  onVote?: (reportId: string, vote: 1 | -1) => void;
  onFlag?: (reportId: string) => void;
  onOpen?: (reportId: string) => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const tier = trustTier(report.confidence);
  const tierLabel =
    tier === 'CONFIRMED'
      ? t('report.trust.confirmed')
      : tier === 'LIKELY'
        ? t('report.trust.likely')
        : t('report.trust.low');
  const tierColor =
    tier === 'CONFIRMED' ? colors.success : tier === 'LIKELY' ? colors.info : colors.textTertiary;

  const confirmations =
    report.upvotes === 1
      ? t('report.confirmationsOne')
      : t('report.confirmations', { count: report.upvotes });

  return (
    <article
      className="rounded-lg border border-border bg-surface p-lg"
      data-source="COMMUNITY"
      data-testid="feed-item"
    >
      <div className="flex flex-col gap-md">
        <div className="flex items-start gap-md">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: `${report.categoryColor}22` }}
          >
            <span
              className="block h-[14px] w-[14px] rounded-pill"
              style={{ backgroundColor: report.categoryColor }}
            />
          </span>

          <div className="flex flex-1 flex-col gap-xxs">
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(report.id)}
                className="self-start text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Text variant="bodyStrong" as="h3">
                  {pick(report.categoryLabel)}
                </Text>
              </button>
            ) : (
              <Text variant="bodyStrong" as="h3">
                {pick(report.categoryLabel)}
              </Text>
            )}
            <Text variant="footnote" color="textTertiary">
              <time dateTime={report.createdAt}>{relativeTimeDe(new Date(report.createdAt))}</time>
              {report.upvotes > 0 ? ` · ${confirmations}` : ''}
            </Text>
          </div>

          <Badge label={tierLabel} color={tierColor} />
        </div>

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

        <div className="flex flex-wrap items-center gap-sm">
          <SourceBadge kind="COMMUNITY" />
          {report.isMine ? <Badge label={t('report.mine')} /> : null}
          <span className="flex-1" />

          {!report.isMine && onVote ? (
            <>
              <VoteButton
                label={t('report.confirm')}
                active={report.myVote === 1}
                onClick={() => onVote(report.id, 1)}
                activeColor={colors.success}
              />
              <VoteButton
                label={t('report.outdated')}
                active={report.myVote === -1}
                onClick={() => onVote(report.id, -1)}
                activeColor={colors.danger}
              />
            </>
          ) : null}
        </div>

        {!report.isMine && onFlag ? (
          <button
            type="button"
            onClick={() => onFlag(report.id)}
            className="min-h-[44px] self-start text-[12px] font-medium leading-4 tracking-[0.2px] text-text-tertiary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {t('report.flag')}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function VoteButton({
  label,
  active,
  onClick,
  activeColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeColor: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex min-h-[44px] items-center rounded-pill border px-md',
        'text-[12px] font-medium leading-4 tracking-[0.2px] transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        active ? '' : 'border-border text-text-secondary hover:bg-surface-sunken',
      )}
      style={active ? { borderColor: activeColor, color: activeColor, backgroundColor: `${activeColor}1A` } : {}}
    >
      {label}
    </button>
  );
}
