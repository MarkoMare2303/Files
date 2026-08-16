import { describe, expect, it } from 'vitest';
import { VehicleType } from '@swissov/types';
import {
  AbuseSignal,
  MAX_PLAUSIBLE_SPEED_KMH,
  checkCooldown,
  checkRateLimit,
  detectDuplicate,
  detectImpossibleTravel,
  detectSpamPattern,
  evaluateGpsPlausibility,
  summarizeFindings,
} from './abuse.js';

const ZURICH = { lat: 47.3779, lon: 8.5403 };
const GENF = { lat: 46.2103, lon: 6.1424 };
const LUGANO = { lat: 46.0053, lon: 8.9471 };

describe('detectImpossibleTravel', () => {
  it('blockiert den Beispielfall aus §21 (Zürich → Genf in 30 Sekunden)', () => {
    const finding = detectImpossibleTravel({
      previous: { ...ZURICH, at: new Date('2025-03-11T17:00:00Z') },
      current: { ...GENF, at: new Date('2025-03-11T17:00:30Z') },
    });
    expect(finding).not.toBeNull();
    expect(finding!.signal).toBe(AbuseSignal.IMPOSSIBLE_TRAVEL);
    expect(finding!.severity).toBe('BLOCK');
  });

  it('erlaubt eine reale Zugfahrt Zürich → Lugano in 2 Stunden', () => {
    const finding = detectImpossibleTravel({
      previous: { ...ZURICH, at: new Date('2025-03-11T15:00:00Z') },
      current: { ...LUGANO, at: new Date('2025-03-11T17:00:00Z') },
    });
    expect(finding).toBeNull();
  });

  it('ignoriert GPS-Rauschen im Stand', () => {
    const finding = detectImpossibleTravel({
      previous: { lat: 47.3779, lon: 8.5403, at: new Date('2025-03-11T17:00:00Z') },
      current: { lat: 47.37793, lon: 8.54035, at: new Date('2025-03-11T17:00:01Z') },
    });
    expect(finding).toBeNull();
  });

  it('hat keine Vorgeschichte zu prüfen, wenn es die erste Meldung ist', () => {
    expect(
      detectImpossibleTravel({
        previous: null,
        current: { ...ZURICH, at: new Date() },
      }),
    ).toBeNull();
  });

  it('liegt die Schwelle über der schnellsten Schweizer Zugfahrt', () => {
    expect(MAX_PLAUSIBLE_SPEED_KMH).toBeGreaterThan(200);
  });
});

describe('evaluateGpsPlausibility', () => {
  it('bewertet eine präzise Position in der Schweiz mit 1', () => {
    const result = evaluateGpsPlausibility({ position: ZURICH, accuracyMeters: 8 });
    expect(result.score).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('blockiert Positionen ausserhalb des Bediengebiets', () => {
    const result = evaluateGpsPlausibility({ position: { lat: 52.52, lon: 13.405 } }); // Berlin
    expect(result.score).toBe(0);
    expect(result.findings[0]!.signal).toBe(AbuseSignal.OUTSIDE_SERVICE_AREA);
    expect(result.findings[0]!.severity).toBe('BLOCK');
  });

  it('markiert sehr ungenaue Positionen, blockiert sie aber nicht', () => {
    const result = evaluateGpsPlausibility({ position: ZURICH, accuracyMeters: 900 });
    expect(result.score).toBeLessThan(0.6);
    expect(result.findings[0]!.severity).toBe('FLAG');
  });

  it('erkennt zum Fahrzeugtyp unpassende Geschwindigkeit', () => {
    const result = evaluateGpsPlausibility({
      position: ZURICH,
      accuracyMeters: 10,
      speedMps: 150 / 3.6,
      vehicleType: VehicleType.TRAM,
    });
    expect(result.findings.some((f) => f.signal === AbuseSignal.IMPLAUSIBLE_GPS)).toBe(true);
    expect(result.score).toBeLessThan(0.7);
  });

  it('bewertet grossen Abstand zur gemeldeten Strecke ab', () => {
    const near = evaluateGpsPlausibility({
      position: ZURICH,
      accuracyMeters: 10,
      distanceToRouteMeters: 50,
    });
    const far = evaluateGpsPlausibility({
      position: ZURICH,
      accuracyMeters: 10,
      distanceToRouteMeters: 4000,
    });
    expect(far.score).toBeLessThan(near.score);
  });
});

describe('checkRateLimit', () => {
  it('blockiert erst beim Erreichen des Limits', () => {
    expect(
      checkRateLimit({ count: 19, limit: 20, windowLabel: 'pro Stunde' }, AbuseSignal.RATE_LIMIT_REPORTS, 'x'),
    ).toBeNull();
    const finding = checkRateLimit(
      { count: 20, limit: 20, windowLabel: 'pro Stunde' },
      AbuseSignal.RATE_LIMIT_REPORTS,
      'Zu viele Meldungen.',
    );
    expect(finding!.severity).toBe('BLOCK');
    expect(finding!.userMessage).toBe('Zu viele Meldungen.');
  });
});

describe('checkCooldown', () => {
  const now = new Date('2025-03-11T17:00:30Z');

  it('blockiert innerhalb der Wartezeit', () => {
    const finding = checkCooldown({
      lastActionAt: new Date('2025-03-11T17:00:20Z'),
      cooldownSeconds: 20,
      now,
    });
    expect(finding).not.toBeNull();
    expect(finding!.userMessage).toContain('10 Sekunden');
  });

  it('lässt nach Ablauf durch', () => {
    expect(
      checkCooldown({ lastActionAt: new Date('2025-03-11T17:00:00Z'), cooldownSeconds: 20, now }),
    ).toBeNull();
  });

  it('greift nicht ohne vorherige Aktion', () => {
    expect(checkCooldown({ lastActionAt: null, cooldownSeconds: 20, now })).toBeNull();
  });
});

describe('detectDuplicate', () => {
  it('blockiert die zweite gleichartige Meldung desselben Nutzers', () => {
    const finding = detectDuplicate({ existingSimilarByUser: true, existingSimilarByOthers: 0 });
    expect(finding!.signal).toBe(AbuseSignal.DUPLICATE);
  });

  it('lässt dieselbe Meldung von anderen Nutzern zu (= Bestätigung)', () => {
    expect(detectDuplicate({ existingSimilarByUser: false, existingSimilarByOthers: 3 })).toBeNull();
  });
});

describe('detectSpamPattern', () => {
  it('erkennt Streuung über viele Orte in kurzer Zeit', () => {
    const finding = detectSpamPattern({
      reportsLast5Minutes: 8,
      distinctContextsLast5Minutes: 8,
      removalRate: 0,
      accountAgeHours: 500,
    });
    expect(finding!.severity).toBe('BLOCK');
  });

  it('lässt mehrere Meldungen zur selben Fahrt zu', () => {
    const finding = detectSpamPattern({
      reportsLast5Minutes: 4,
      distinctContextsLast5Minutes: 1,
      removalRate: 0,
      accountAgeHours: 500,
    });
    expect(finding).toBeNull();
  });

  it('markiert Nutzer mit hoher Entfernungsquote', () => {
    const finding = detectSpamPattern({
      reportsLast5Minutes: 2,
      distinctContextsLast5Minutes: 1,
      removalRate: 0.8,
      accountAgeHours: 500,
    });
    expect(finding!.severity).toBe('FLAG');
  });

  it('markiert Bursts von brandneuen Konten', () => {
    const finding = detectSpamPattern({
      reportsLast5Minutes: 3,
      distinctContextsLast5Minutes: 1,
      removalRate: 0,
      accountAgeHours: 0.2,
    });
    expect(finding!.severity).toBe('FLAG');
  });
});

describe('summarizeFindings', () => {
  it('priorisiert blockierende Befunde', () => {
    const result = summarizeFindings([
      null,
      { signal: AbuseSignal.IMPLAUSIBLE_GPS, severity: 'FLAG', message: 'a', userMessage: 'a' },
      { signal: AbuseSignal.DUPLICATE, severity: 'BLOCK', message: 'b', userMessage: 'b' },
    ]);
    expect(result.blocked).toBe(true);
    expect(result.blocking!.signal).toBe(AbuseSignal.DUPLICATE);
    expect(result.flags).toHaveLength(1);
    expect(result.all).toHaveLength(2);
  });

  it('meldet keine Blockade, wenn nur Markierungen vorliegen', () => {
    const result = summarizeFindings([
      { signal: AbuseSignal.IMPLAUSIBLE_GPS, severity: 'FLAG', message: 'a', userMessage: 'a' },
    ]);
    expect(result.blocked).toBe(false);
    expect(result.blocking).toBeNull();
  });
});
