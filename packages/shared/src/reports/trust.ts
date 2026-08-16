import type { RuntimeConfig } from '@swissov/types';
import { clamp } from '../geo.js';

export interface TrustInput {
  upvotes: number;
  downvotes: number;
  createdAt: Date;
  /** Reputationswert des Melders (siehe `reputation.ts`), typisch -100..100. */
  authorReputation: number;
  /**
   * War der Melder zum Zeitpunkt der Meldung nachweislich einer Trip-Session
   * zugeordnet? Das ist das stärkste Einzelsignal für Glaubwürdigkeit.
   */
  hadTripSession: boolean;
  /** Confidence der zugehörigen Trip-Session (0..1); `null` wenn keine vorhanden. */
  tripSessionConfidence: number | null;
  /** Ergebnis der GPS-Plausibilitätsprüfung (0..1). */
  gpsPlausibility: number;
  /** Anzahl offener Missbrauchsmeldungen. */
  flagsCount: number;
  /** Anzahl Meldungen desselben Nutzers in der letzten Stunde (Spam-Signal). */
  recentReportsByAuthor: number;
}

/** Logarithmische Sättigung: 10 Stimmen entsprechen dem vollen Gewicht. */
function voteSaturation(count: number): number {
  if (count <= 0) return 0;
  return Math.min(1, Math.log1p(count) / Math.log1p(10));
}

/**
 * Trust Score einer Meldung, 0–100 (§19).
 *
 * Interpretation gemäss Vorgabe:
 *   0–30   geringe Sicherheit
 *   31–69  wahrscheinlich
 *   70–100 mehrfach bestätigt
 */
export function computeTrustScore(input: TrustInput, config: RuntimeConfig['trust'], now: Date = new Date()): number {
  const ageMinutes = Math.max(0, (now.getTime() - input.createdAt.getTime()) / 60_000);
  const decay = Math.pow(0.5, ageMinutes / Math.max(1, config.ageDecayHalfLifeMinutes));

  let score = config.baseScore;

  // Bestätigungen und Gegenstimmen; ihr Einfluss verblasst mit der Zeit,
  // damit alte, längst überholte Meldungen nicht dauerhaft „bestätigt" bleiben.
  score += voteSaturation(input.upvotes) * config.upvoteWeight * decay;
  score -= voteSaturation(input.downvotes) * config.downvoteWeight;

  // Nachgewiesene Anwesenheit im Fahrzeug.
  if (input.hadTripSession) {
    const confidence = input.tripSessionConfidence ?? 0.7;
    score += config.tripSessionBonus * clamp(confidence, 0, 1);
  } else {
    score -= config.tripSessionBonus * 0.4;
  }

  // GPS-Plausibilität.
  score += config.gpsPlausibilityBonus * clamp(input.gpsPlausibility, 0, 1);
  score -= config.gpsPlausibilityBonus * (1 - clamp(input.gpsPlausibility, 0, 1));

  // Reputation des Melders, normiert auf -1..1.
  const normalizedReputation = clamp(input.authorReputation / 100, -1, 1);
  score += normalizedReputation * config.reputationWeight;

  // Missbrauchsmeldungen wirken sofort stark negativ.
  score -= Math.min(40, input.flagsCount * 12);

  // Spam-Signal: viele Meldungen in kurzer Zeit.
  if (input.recentReportsByAuthor > 5) {
    score -= Math.min(20, (input.recentReportsByAuthor - 5) * 4);
  }

  return Math.round(clamp(score, 0, 100));
}

export type TrustTier = 'LOW' | 'LIKELY' | 'CONFIRMED';

export function trustTier(score: number): TrustTier {
  if (score <= 30) return 'LOW';
  if (score <= 69) return 'LIKELY';
  return 'CONFIRMED';
}
