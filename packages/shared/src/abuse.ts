import { SWITZERLAND_BBOX, VEHICLE_SPEED_PROFILE, type VehicleType } from '@swissov/types';
import { clamp, haversineMeters, isInsideBoundingBox, type LatLon } from './geo.js';

/**
 * Missbrauchsschutz (§21).
 *
 * Alle Funktionen hier sind rein und ohne I/O — das Zählen bzw. Nachschlagen
 * passiert in der API. Dadurch sind die Regeln vollständig unit-testbar.
 */

export const AbuseSignal = {
  RATE_LIMIT_REPORTS: 'RATE_LIMIT_REPORTS',
  RATE_LIMIT_VOTES: 'RATE_LIMIT_VOTES',
  COOLDOWN: 'COOLDOWN',
  DUPLICATE: 'DUPLICATE',
  IMPOSSIBLE_TRAVEL: 'IMPOSSIBLE_TRAVEL',
  OUTSIDE_SERVICE_AREA: 'OUTSIDE_SERVICE_AREA',
  IMPLAUSIBLE_GPS: 'IMPLAUSIBLE_GPS',
  SPAM_PATTERN: 'SPAM_PATTERN',
  NO_TRIP_CONTEXT: 'NO_TRIP_CONTEXT',
} as const;
export type AbuseSignal = (typeof AbuseSignal)[keyof typeof AbuseSignal];

export interface AbuseFinding {
  signal: AbuseSignal;
  /** `BLOCK` verhindert die Aktion, `FLAG` lässt sie zu und markiert sie. */
  severity: 'BLOCK' | 'FLAG';
  message: string;
  /** Deutscher Text für die App-Oberfläche (§44). */
  userMessage: string;
}

/**
 * Höchste plausible Reisegeschwindigkeit im Schweizer ÖV inkl. Puffer.
 * Der schnellste reguläre Zug fährt 200 km/h; 350 km/h schliesst auch
 * Fahrten im Auto/Flugzeug nicht aus, markiert aber teleportierende Accounts.
 */
export const MAX_PLAUSIBLE_SPEED_KMH = 350;

export interface ImpossibleTravelInput {
  previous: { lat: number; lon: number; at: Date } | null;
  current: { lat: number; lon: number; at: Date };
}

/**
 * Erkennt physikalisch unmögliche Ortswechsel — der Kernfall aus §21:
 * „20 Meldungen in 20 verschiedenen Städten innerhalb von 30 Sekunden".
 */
export function detectImpossibleTravel({
  previous,
  current,
}: ImpossibleTravelInput): AbuseFinding | null {
  if (!previous) return null;
  const seconds = (current.at.getTime() - previous.at.getTime()) / 1000;
  if (seconds <= 0) return null;
  const meters = haversineMeters(previous, current);
  // Unter 60 m ist GPS-Rauschen dominant.
  if (meters < 60) return null;
  const speedKmh = (meters / seconds) * 3.6;
  if (speedKmh <= MAX_PLAUSIBLE_SPEED_KMH) return null;
  return {
    signal: AbuseSignal.IMPOSSIBLE_TRAVEL,
    severity: 'BLOCK',
    message: `Impossible travel: ${meters.toFixed(0)} m in ${seconds.toFixed(0)} s (${speedKmh.toFixed(0)} km/h)`,
    userMessage:
      'Deine Position hat sich zu schnell verändert. Bitte versuche es in einem Moment erneut.',
  };
}

export interface GpsPlausibilityInput {
  position: LatLon;
  accuracyMeters?: number | undefined;
  speedMps?: number | undefined;
  /** Fahrzeugtyp der bezogenen Fahrt; ermöglicht Geschwindigkeitsprüfung. */
  vehicleType?: VehicleType | undefined;
  /** Abstand zur Streckenlinie der bezogenen Fahrt in Metern, falls bekannt. */
  distanceToRouteMeters?: number | null | undefined;
}

export interface GpsPlausibilityResult {
  /** 0..1 — fliesst in den Trust Score ein. */
  score: number;
  findings: AbuseFinding[];
}

/** Bewertet, wie plausibel eine gemeldete Position ist. */
export function evaluateGpsPlausibility(input: GpsPlausibilityInput): GpsPlausibilityResult {
  const findings: AbuseFinding[] = [];
  let score = 1;

  if (!isInsideBoundingBox(input.position, {
    minLat: SWITZERLAND_BBOX.minLat,
    maxLat: SWITZERLAND_BBOX.maxLat,
    minLon: SWITZERLAND_BBOX.minLon,
    maxLon: SWITZERLAND_BBOX.maxLon,
  })) {
    findings.push({
      signal: AbuseSignal.OUTSIDE_SERVICE_AREA,
      severity: 'BLOCK',
      message: 'Position ausserhalb des Bediengebiets (Schweiz inkl. Grenzregionen)',
      userMessage:
        'Diese App deckt den öffentlichen Verkehr in der Schweiz ab. Für deinen Standort können wir keine Meldung erfassen.',
    });
    return { score: 0, findings };
  }

  const accuracy = input.accuracyMeters;
  if (accuracy !== undefined) {
    if (accuracy > 500) {
      score -= 0.5;
      findings.push({
        signal: AbuseSignal.IMPLAUSIBLE_GPS,
        severity: 'FLAG',
        message: `GPS-Genauigkeit ${accuracy.toFixed(0)} m ist sehr niedrig`,
        userMessage: 'Dein Standort ist gerade ungenau. Die Meldung wird trotzdem erfasst.',
      });
    } else if (accuracy > 150) {
      score -= 0.25;
    } else if (accuracy <= 25) {
      score = Math.min(1, score + 0.05);
    }
  } else {
    score -= 0.1;
  }

  if (input.speedMps !== undefined && input.vehicleType) {
    const profile = VEHICLE_SPEED_PROFILE[input.vehicleType];
    const speedKmh = input.speedMps * 3.6;
    if (speedKmh > profile.max * 1.2) {
      score -= 0.4;
      findings.push({
        signal: AbuseSignal.IMPLAUSIBLE_GPS,
        severity: 'FLAG',
        message: `Geschwindigkeit ${speedKmh.toFixed(0)} km/h passt nicht zu ${input.vehicleType}`,
        userMessage: 'Die gemessene Geschwindigkeit passt nicht zur gewählten Fahrt.',
      });
    }
  }

  const distance = input.distanceToRouteMeters;
  if (distance !== null && distance !== undefined) {
    if (distance > 2000) {
      score -= 0.5;
      findings.push({
        signal: AbuseSignal.IMPLAUSIBLE_GPS,
        severity: 'FLAG',
        message: `${distance.toFixed(0)} m Abstand zur gemeldeten Strecke`,
        userMessage: 'Du scheinst dich nicht auf dieser Strecke zu befinden.',
      });
    } else if (distance > 500) {
      score -= 0.2;
    }
  }

  return { score: clamp(score, 0, 1), findings };
}

export interface RateLimitCheck {
  count: number;
  limit: number;
  windowLabel: string;
}

export function checkRateLimit(
  check: RateLimitCheck,
  signal: AbuseSignal,
  userMessage: string,
): AbuseFinding | null {
  if (check.count < check.limit) return null;
  return {
    signal,
    severity: 'BLOCK',
    message: `Rate limit exceeded: ${check.count}/${check.limit} ${check.windowLabel}`,
    userMessage,
  };
}

export interface CooldownInput {
  lastActionAt: Date | null;
  cooldownSeconds: number;
  now?: Date;
}

export function checkCooldown({
  lastActionAt,
  cooldownSeconds,
  now = new Date(),
}: CooldownInput): AbuseFinding | null {
  if (!lastActionAt || cooldownSeconds <= 0) return null;
  const elapsed = (now.getTime() - lastActionAt.getTime()) / 1000;
  if (elapsed >= cooldownSeconds) return null;
  const remaining = Math.ceil(cooldownSeconds - elapsed);
  return {
    signal: AbuseSignal.COOLDOWN,
    severity: 'BLOCK',
    message: `Cooldown active, ${remaining}s remaining`,
    userMessage: `Bitte warte noch ${remaining} Sekunden, bis du erneut meldest.`,
  };
}

export interface DuplicateCheckInput {
  /** Existiert bereits eine aktive Meldung desselben Nutzers mit gleicher Kategorie und gleichem Bezug? */
  existingSimilarByUser: boolean;
  /**
   * Anzahl aktiver Meldungen derselben Kategorie auf demselben Bezug von
   * anderen Nutzern — das ist keine Dublette, sondern eine Bestätigung.
   */
  existingSimilarByOthers: number;
}

/**
 * Dubletten desselben Nutzers werden blockiert. Meldet ein anderer Nutzer
 * dasselbe, ist das eine Bestätigung — die App leitet in diesem Fall auf
 * die bestehende Meldung um, statt eine zweite zu erzeugen.
 */
export function detectDuplicate(input: DuplicateCheckInput): AbuseFinding | null {
  if (!input.existingSimilarByUser) return null;
  return {
    signal: AbuseSignal.DUPLICATE,
    severity: 'BLOCK',
    message: 'Duplicate report by same user for same context',
    userMessage:
      'Du hast dazu bereits eine aktive Meldung erstellt. Du kannst sie bestätigen oder als überholt markieren.',
  };
}

export interface SpamPatternInput {
  /** Meldungen des Nutzers in den letzten 5 Minuten. */
  reportsLast5Minutes: number;
  /** Anzahl verschiedener Bezugsobjekte (Trips/Stops) in diesen Meldungen. */
  distinctContextsLast5Minutes: number;
  /** Anteil der Meldungen des Nutzers, die moderativ entfernt wurden (0..1). */
  removalRate: number;
  /** Kontoalter in Stunden. */
  accountAgeHours: number;
}

/**
 * Heuristik für Spam-Muster. Beispiel aus §21: viele Meldungen in kurzer Zeit
 * über viele verschiedene Orte hinweg.
 */
export function detectSpamPattern(input: SpamPatternInput): AbuseFinding | null {
  const scatter =
    input.reportsLast5Minutes >= 5 &&
    input.distinctContextsLast5Minutes >= 4 &&
    input.distinctContextsLast5Minutes >= input.reportsLast5Minutes * 0.8;

  if (scatter) {
    return {
      signal: AbuseSignal.SPAM_PATTERN,
      severity: 'BLOCK',
      message: `Scatter pattern: ${input.reportsLast5Minutes} reports across ${input.distinctContextsLast5Minutes} contexts in 5 min`,
      userMessage:
        'Wir konnten deine Meldung nicht verarbeiten. Bitte melde nur, was du selbst gerade erlebst.',
    };
  }

  if (input.removalRate >= 0.5 && input.reportsLast5Minutes >= 2) {
    return {
      signal: AbuseSignal.SPAM_PATTERN,
      severity: 'FLAG',
      message: `High removal rate (${(input.removalRate * 100).toFixed(0)} %)`,
      userMessage: 'Deine Meldung wird vor der Veröffentlichung geprüft.',
    };
  }

  if (input.accountAgeHours < 1 && input.reportsLast5Minutes >= 3) {
    return {
      signal: AbuseSignal.SPAM_PATTERN,
      severity: 'FLAG',
      message: 'New account with burst activity',
      userMessage: 'Deine Meldung wird vor der Veröffentlichung geprüft.',
    };
  }

  return null;
}

/** Fasst mehrere Prüfungen zusammen und entscheidet über Blockade/Markierung. */
export function summarizeFindings(findings: Array<AbuseFinding | null>): {
  blocked: boolean;
  blocking: AbuseFinding | null;
  flags: AbuseFinding[];
  all: AbuseFinding[];
} {
  const all = findings.filter((f): f is AbuseFinding => f !== null);
  const blocking = all.find((f) => f.severity === 'BLOCK') ?? null;
  return {
    blocked: blocking !== null,
    blocking,
    flags: all.filter((f) => f.severity === 'FLAG'),
    all,
  };
}
