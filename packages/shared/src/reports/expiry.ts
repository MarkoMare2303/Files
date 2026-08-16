import type { ReportCategory, RuntimeConfig } from '@swissov/types';

export interface ExpiryInput {
  category: Pick<ReportCategory, 'ttlSeconds' | 'ttlUntilTripEnd'>;
  createdAt: Date;
  /** Planmässiges (bzw. prognostiziertes) Fahrtende der bezogenen Fahrt. */
  tripEndsAt?: Date | null;
}

/** Untergrenze, damit eine Meldung nie sofort wieder verschwindet. */
export const MIN_TTL_SECONDS = 120;
/** Obergrenze für fahrtgebundene Meldungen nach Fahrtende. */
export const MAX_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Berechnet den Ablaufzeitpunkt einer Meldung (§17).
 *
 * Kategorien mit `ttlUntilTripEnd` (z. B. „Klimaanlage ausgefallen") bleiben
 * bis zum Ende der Fahrt sichtbar, mindestens aber die konfigurierte TTL —
 * sonst wäre eine Meldung kurz vor Endstation sofort unsichtbar.
 */
export function computeExpiresAt({ category, createdAt, tripEndsAt }: ExpiryInput): Date {
  const ttlSeconds = Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, category.ttlSeconds));
  const byTtl = new Date(createdAt.getTime() + ttlSeconds * 1000);
  if (!category.ttlUntilTripEnd || !tripEndsAt) return byTtl;
  // Kleiner Nachlauf, damit Umsteigende die Meldung noch sehen.
  const tripEndWithBuffer = new Date(tripEndsAt.getTime() + 5 * 60 * 1000);
  return tripEndWithBuffer.getTime() > byTtl.getTime() ? tripEndWithBuffer : byTtl;
}

export function isExpired(report: { expiresAt: Date }, now: Date = new Date()): boolean {
  return report.expiresAt.getTime() <= now.getTime();
}

export interface AutoExpireInput {
  upvotes: number;
  downvotes: number;
}

/**
 * Community-getriebenes vorzeitiges Ende: Wenn deutlich mehr Nutzer
 * „Nicht mehr aktuell" als „Trifft zu" wählen, endet die Meldung sofort (§18).
 */
export function shouldAutoExpire(
  { upvotes, downvotes }: AutoExpireInput,
  config: RuntimeConfig['moderation'],
): boolean {
  const total = upvotes + downvotes;
  if (total < config.autoExpireMinVotes) return false;
  return downvotes / total >= config.autoExpireDownvoteRatio;
}
