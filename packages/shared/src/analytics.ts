/**
 * Produktmetriken (§61).
 *
 * Bewusst geschlossene Ereignisliste ohne freie Properties. Es werden keine
 * Koordinaten, keine Trip-IDs und keine Nutzer-IDs übertragen — nur
 * kategoriale Werte, die für Produktentscheide reichen.
 */
export const AnalyticsEvent = {
  ONBOARDING_COMPLETED: 'onboarding_completed',
  LOCATION_PERMISSION_RESULT: 'location_permission_result',
  TRIP_DETECTED: 'trip_detected',
  TRIP_DETECTION_CONFIRMED: 'trip_detection_confirmed',
  TRIP_MANUALLY_SELECTED: 'trip_manually_selected',
  TRIP_SESSION_ENDED: 'trip_session_ended',
  REPORT_SUBMITTED: 'report_submitted',
  REPORT_CONFIRMED: 'report_confirmed',
  REPORT_DISPUTED: 'report_disputed',
  REPORT_QUEUED_OFFLINE: 'report_queued_offline',
  SEARCH_PERFORMED: 'search_performed',
  FAVORITE_ADDED: 'favorite_added',
  TRIP_FOLLOW_ENABLED: 'trip_follow_enabled',
} as const;
export type AnalyticsEvent = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/** Erlaubte Eigenschaften je Ereignis — alles andere wird verworfen. */
export interface AnalyticsProperties {
  /** Nur die grobe Kategorie, nie die konkrete Linie. */
  vehicleType?: string;
  /** Confidence-Band statt exaktem Wert. */
  confidenceBand?: 'high' | 'medium' | 'low';
  detectionMethod?: 'AUTO_GPS' | 'AUTO_STOP_SEQUENCE' | 'MANUAL';
  categoryKey?: string;
  result?: 'granted' | 'denied' | 'later';
  source?: 'map' | 'trip' | 'home' | 'search';
  durationBand?: 'lt5s' | 'lt15s' | 'lt60s' | 'gte60s';
}

export interface AnalyticsAdapter {
  track(event: AnalyticsEvent, properties?: AnalyticsProperties): void;
  /** Wird bei Widerruf der Einwilligung aufgerufen. */
  reset(): void;
}

/** Standardimplementierung ohne Einwilligung: verwirft alles. */
export const noopAnalytics: AnalyticsAdapter = {
  track: () => undefined,
  reset: () => undefined,
};

export function confidenceBand(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}

export function durationBand(ms: number): 'lt5s' | 'lt15s' | 'lt60s' | 'gte60s' {
  if (ms < 5_000) return 'lt5s';
  if (ms < 15_000) return 'lt15s';
  if (ms < 60_000) return 'lt60s';
  return 'gte60s';
}
