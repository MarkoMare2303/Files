import { clamp } from './geo.js';

/**
 * Reputationsereignisse (§20).
 *
 * Reputation ist ein rein internes Signal für Trust-Berechnung und Moderation.
 * Sie wird bewusst NICHT als öffentlicher Punktestand angezeigt, damit kein
 * sozialer Wettbewerb entsteht, der zu Falschmeldungen anreizt.
 */
export const ReputationEventType = {
  REPORT_CONFIRMED: 'REPORT_CONFIRMED',
  REPORT_DISPUTED: 'REPORT_DISPUTED',
  REPORT_REMOVED_BY_MODERATION: 'REPORT_REMOVED_BY_MODERATION',
  REPORT_CREATED_WITH_SESSION: 'REPORT_CREATED_WITH_SESSION',
  VOTE_MATCHED_CONSENSUS: 'VOTE_MATCHED_CONSENSUS',
  SPAM_DETECTED: 'SPAM_DETECTED',
  IMPLAUSIBLE_LOCATION: 'IMPLAUSIBLE_LOCATION',
  DUPLICATE_REPORT: 'DUPLICATE_REPORT',
  ACCOUNT_AGE_MILESTONE: 'ACCOUNT_AGE_MILESTONE',
} as const;
export type ReputationEventType =
  (typeof ReputationEventType)[keyof typeof ReputationEventType];

/** Punktwerte je Ereignis. Bewusst asymmetrisch: Missbrauch wiegt schwerer. */
export const REPUTATION_DELTAS: Record<ReputationEventType, number> = {
  REPORT_CONFIRMED: 3,
  REPORT_DISPUTED: -2,
  REPORT_REMOVED_BY_MODERATION: -15,
  REPORT_CREATED_WITH_SESSION: 1,
  VOTE_MATCHED_CONSENSUS: 1,
  SPAM_DETECTED: -25,
  IMPLAUSIBLE_LOCATION: -10,
  DUPLICATE_REPORT: -3,
  ACCOUNT_AGE_MILESTONE: 5,
};

export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;

export function applyReputationEvent(current: number, type: ReputationEventType): number {
  return clamp(current + REPUTATION_DELTAS[type], REPUTATION_MIN, REPUTATION_MAX);
}

export type ReputationTier = 'NEW' | 'ESTABLISHED' | 'TRUSTED';

export interface ReputationTierInput {
  score: number;
  accountAgeDays: number;
  confirmedReports: number;
}

/**
 * Grobe Stufe, die dem Nutzer selbst angezeigt werden darf.
 * Erfordert bewusst sowohl Punkte als auch Kontohistorie — ein frisch
 * angelegtes Konto kann sich nicht durch Massenaktivität hochstufen.
 */
export function reputationTier({
  score,
  accountAgeDays,
  confirmedReports,
}: ReputationTierInput): ReputationTier {
  if (score >= 40 && accountAgeDays >= 30 && confirmedReports >= 10) return 'TRUSTED';
  if (score >= 10 && accountAgeDays >= 7 && confirmedReports >= 2) return 'ESTABLISHED';
  return 'NEW';
}

/**
 * Ob Meldungen dieses Nutzers vor der Veröffentlichung moderiert werden müssen.
 * Schwelle kommt aus der Laufzeitkonfiguration.
 */
export function requiresPreModeration(score: number, threshold: number): boolean {
  return score < threshold;
}
