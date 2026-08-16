'use client';

import React from 'react';
import { t } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { Badge } from './primitives';

/**
 * Quellen- und Datenherkunfts-Kennzeichnung (§7).
 *
 * Das ist die wichtigste Komponente der ganzen Oberfläche. Sie beantwortet:
 * *Woher weiss die App das?* Die fünf Fälle sind bewusst getrennt:
 *
 *   OFFIZIELL   — Meldung des Verkehrsbetriebs (GTFS-RT Service Alert)
 *   COMMUNITY   — Meldung von Nutzerinnen und Nutzern, ungeprüft
 *   LIVE        — Echtzeitdaten des Betreibers (GTFS-RT TripUpdate)
 *   FAHRPLAN    — Sollzeit aus dem statischen Fahrplan
 *   GESCHÄTZT   — von uns berechnet, nicht vom Betreiber bestätigt
 *
 * Es ist ausdrücklich verboten, zwei dieser Fälle in einem Badge zu
 * verschmelzen oder das Label wegzulassen, weil es „eng" ist. Wer nicht sieht,
 * ob eine Kontrollmeldung offiziell oder aus der Community stammt, wird
 * getäuscht.
 *
 * Farbe allein trägt die Bedeutung nicht: jedes Badge hat einen Text, und
 * `official`/`community` unterscheiden sich zusätzlich in der Helligkeit
 * (siehe Kontrasttests in `packages/ui`).
 */
export type SourceKind = 'OFFICIAL' | 'COMMUNITY' | 'REALTIME' | 'SCHEDULED' | 'ESTIMATED';

export function SourceBadge({
  kind,
  className,
}: {
  kind: SourceKind;
  className?: string;
}): React.JSX.Element {
  const { colors } = useTheme();

  switch (kind) {
    case 'OFFICIAL':
      return (
        <Badge
          label={t('common.official')}
          color={colors.onOfficial}
          background={colors.official}
          className={className}
        />
      );
    case 'COMMUNITY':
      return (
        <Badge
          label={t('common.community')}
          color={colors.onCommunity}
          background={colors.community}
          className={className}
        />
      );
    case 'REALTIME':
      return (
        <Badge
          label={t('source.realtime')}
          color={colors.success}
          background={colors.successSubtle}
          className={className}
        />
      );
    case 'SCHEDULED':
      return (
        <Badge
          label={t('source.scheduled')}
          color={colors.textSecondary}
          background={colors.surfaceSunken}
          className={className}
        />
      );
    case 'ESTIMATED':
      return (
        <Badge
          label={t('source.estimated')}
          color={colors.warning}
          background={colors.warningSubtle}
          className={className}
        />
      );
  }
}

/**
 * Leitet aus einer Abfahrt ab, worauf die angezeigte Zeit beruht.
 *
 * `realtimeDeparture` kommt direkt aus GTFS-RT und ist damit die Aussage des
 * Betriebs. Liegt nur eine Verspätung ohne Zeitpunkt vor, ist die angezeigte
 * Zeit gerechnet — dann GESCHÄTZT, nicht LIVE.
 */
export function departureSource(departure: {
  realtimeDeparture?: string | null;
  delaySeconds?: number | null;
}): SourceKind {
  if (departure.realtimeDeparture) return 'REALTIME';
  if (departure.delaySeconds !== null && departure.delaySeconds !== undefined) return 'ESTIMATED';
  return 'SCHEDULED';
}
