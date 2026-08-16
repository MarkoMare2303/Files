import type { DetectionDecision } from '@swissov/types';
import type { ScoredCandidate } from './types.js';

export interface DetectionThresholds {
  /** Ab hier wird die Fahrt automatisch übernommen (§11: 0.90). */
  auto: number;
  /** Ab hier wird der Nutzer um Bestätigung gebeten (§11: 0.70). */
  confirm: number;
}

export const DEFAULT_DETECTION_THRESHOLDS: DetectionThresholds = {
  auto: 0.9,
  confirm: 0.7,
};

/**
 * Mindestabstand zur zweitbesten Fahrt, damit automatisch ausgewählt wird.
 *
 * Zwei parallel verkehrende Züge (z. B. S-Bahn und IC auf derselben Trasse)
 * erzeugen ähnliche Scores. Ohne Abstandskriterium würde die App eine
 * Zufallsentscheidung als Gewissheit ausgeben — das ist genau der Fall, in dem
 * eine Rückfrage angebracht ist.
 */
export const MIN_MARGIN_FOR_AUTO = 0.08;

export function decideDetection(
  candidates: ScoredCandidate[],
  thresholds: DetectionThresholds = DEFAULT_DETECTION_THRESHOLDS,
): DetectionDecision {
  if (candidates.length === 0) return 'NONE';
  const best = candidates[0]!;
  if (best.confidence < thresholds.confirm) {
    // Auch schwache Kandidaten werden angezeigt — der Nutzer darf nie
    // wegen schlechter GPS-Daten ausgesperrt werden (§12).
    return best.confidence > 0.2 ? 'CHOOSE' : 'NONE';
  }
  if (best.confidence >= thresholds.auto) {
    const second = candidates[1];
    if (!second || best.confidence - second.confidence >= MIN_MARGIN_FOR_AUTO) {
      return 'AUTO_SELECT';
    }
    return 'CONFIRM';
  }
  return 'CONFIRM';
}
