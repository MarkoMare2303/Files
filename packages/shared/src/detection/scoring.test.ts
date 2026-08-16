import { describe, expect, it } from 'vitest';
import { VehicleType } from '@swissov/types';
import {
  BUS_BASEL,
  FIXTURE_STOPS,
  IC1_BERN_ZURICH,
  IC3_BASEL_ZURICH,
  IC3_ZURICH_BASEL,
  POSTAUTO_RURAL,
  TRAM_ZURICH,
  buildCandidate,
  observationBetween,
} from './fixtures.js';
import { DEFAULT_SCORE_WEIGHTS, scoreCandidate, scoreCandidates } from './scoring.js';
import { DEFAULT_DETECTION_THRESHOLDS, decideDetection } from './decision.js';
import type { Observation } from './types.js';

/** 17:38 Ortszeit am 11.03.2025 (MEZ) = 16:38 UTC — das Beispiel aus §10. */
const AT_1738 = new Date('2025-03-11T16:38:00Z');
const AT_1736 = new Date('2025-03-11T16:36:00Z');

/** Nutzer im IC zwischen Zürich HB und Zürich Altstetten, 87 km/h, Richtung Westen. */
function icObservation(timestamp = AT_1738, fraction = 0.75): Observation {
  return observationBetween(
    FIXTURE_STOPS.zurichHb,
    FIXTURE_STOPS.zurichAltstetten,
    fraction,
    timestamp,
    { speedMps: 87 / 3.6, accuracyMeters: 15 },
  );
}

describe('Szenario aus §10: IC zwischen Zürich HB und Altstetten', () => {
  const latest = icObservation();
  const earlier = icObservation(AT_1736, 0.45);

  it('erkennt die richtige Fahrt mit hoher Confidence', () => {
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest, { previousObservation: earlier });
    const scored = scoreCandidate(candidate, [earlier, latest]);
    expect(scored.confidence).toBeGreaterThanOrEqual(0.9);
    expect(scored.candidate.destination).toBe('Basel SBB');
  });

  it('bewertet die Gegenrichtung deutlich schlechter', () => {
    const forward = buildCandidate(IC3_ZURICH_BASEL, latest, { previousObservation: earlier });
    const backward = buildCandidate(IC3_BASEL_ZURICH, latest, { previousObservation: earlier });
    const [best, second] = scoreCandidates([backward, forward], [earlier, latest]);
    expect(best!.candidate.tripId).toBe(IC3_ZURICH_BASEL.tripId);
    expect(best!.confidence - second!.confidence).toBeGreaterThan(0.15);
    expect(second!.breakdown.directionCompatibility.raw).toBeLessThan(0.2);
  });

  it('schliesst ein Tram bei 87 km/h praktisch aus', () => {
    const tram = buildCandidate(TRAM_ZURICH, latest, { previousObservation: earlier });
    const scored = scoreCandidate(tram, [earlier, latest]);
    expect(scored.breakdown.speedCompatibility.raw).toBe(0);
    expect(scored.confidence).toBeLessThan(0.5);
  });

  it('wählt aus einem gemischten Kandidatenfeld die richtige Fahrt', () => {
    const observations = [earlier, latest];
    const candidates = [
      buildCandidate(TRAM_ZURICH, latest, { previousObservation: earlier }),
      buildCandidate(IC3_BASEL_ZURICH, latest, { previousObservation: earlier }),
      buildCandidate(BUS_BASEL, latest, { previousObservation: earlier }),
      buildCandidate(IC3_ZURICH_BASEL, latest, { previousObservation: earlier }),
      buildCandidate(IC1_BERN_ZURICH, latest, { previousObservation: earlier }),
      buildCandidate(POSTAUTO_RURAL, latest, { previousObservation: earlier }),
    ];
    const scored = scoreCandidates(candidates, observations);
    expect(scored[0]!.candidate.tripId).toBe(IC3_ZURICH_BASEL.tripId);
    expect(decideDetection(scored)).toBe('AUTO_SELECT');
  });
});

describe('scoreShapeDistance', () => {
  const latest = icObservation();

  it('gibt bei Position exakt auf der Linie nahezu 1', () => {
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest);
    const scored = scoreCandidate(candidate, [latest]);
    expect(scored.breakdown.shapeDistance.raw).toBeGreaterThan(0.95);
  });

  it('fällt mit wachsendem Abstand ab', () => {
    const offRoute: Observation = { ...latest, lat: latest.lat + 0.02 }; // ~2,2 km nördlich
    const candidate = buildCandidate(IC3_ZURICH_BASEL, offRoute);
    const scored = scoreCandidate(candidate, [offRoute]);
    expect(scored.breakdown.shapeDistance.raw).toBeLessThan(0.05);
  });

  it('berücksichtigt schlechte GPS-Genauigkeit als zusätzliche Toleranz', () => {
    const slightlyOff: Observation = { ...latest, lat: latest.lat + 0.0006, accuracyMeters: 12 };
    const sameButInaccurate: Observation = { ...slightlyOff, accuracyMeters: 200 };
    const precise = scoreCandidate(buildCandidate(IC3_ZURICH_BASEL, slightlyOff), [slightlyOff]);
    const inaccurate = scoreCandidate(buildCandidate(IC3_ZURICH_BASEL, sameButInaccurate), [
      sameButInaccurate,
    ]);
    expect(inaccurate.breakdown.shapeDistance.raw).toBeGreaterThan(
      precise.breakdown.shapeDistance.raw,
    );
  });
});

describe('scoreTimeCompatibility', () => {
  it('bewertet eine Beobachtung lange vor Fahrtbeginn schlecht', () => {
    const tooEarly = icObservation(new Date('2025-03-11T14:00:00Z'));
    const candidate = buildCandidate(IC3_ZURICH_BASEL, tooEarly);
    const scored = scoreCandidate(candidate, [tooEarly]);
    expect(scored.breakdown.timeCompatibility.raw).toBeLessThan(0.4);
  });

  it('berücksichtigt Verspätung beim Fahrtende', () => {
    // 5 Minuten nach planmässigem Fahrtende (18:35 lokal = 17:35 UTC)
    const afterEnd = observationBetween(
      FIXTURE_STOPS.liestal,
      FIXTURE_STOPS.baselSbb,
      0.9,
      new Date('2025-03-11T17:40:00Z'),
      { speedMps: 20 },
    );
    const withoutDelay = scoreCandidate(buildCandidate(IC3_ZURICH_BASEL, afterEnd), [afterEnd]);
    const withDelay = scoreCandidate(
      buildCandidate(IC3_ZURICH_BASEL, afterEnd, { realtimeDelaySeconds: 600 }),
      [afterEnd],
    );
    expect(withDelay.breakdown.timeCompatibility.raw).toBeGreaterThan(
      withoutDelay.breakdown.timeCompatibility.raw,
    );
  });
});

describe('scoreDirection', () => {
  it('liefert den Neutralwert, wenn kein Kurs bekannt ist', () => {
    const noHeading: Observation = { ...icObservation(), headingDegrees: undefined, speedMps: 0 };
    const scored = scoreCandidate(buildCandidate(IC3_ZURICH_BASEL, noHeading), [noHeading]);
    expect(scored.breakdown.directionCompatibility.raw).toBeCloseTo(0.6, 5);
  });

  it('leitet den Kurs aus dem Positionsverlauf ab, wenn das Gerät keinen liefert', () => {
    const earlier: Observation = {
      ...icObservation(AT_1736, 0.3),
      headingDegrees: undefined,
    };
    const latest: Observation = { ...icObservation(AT_1738, 0.75), headingDegrees: undefined };
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest, { previousObservation: earlier });
    const scored = scoreCandidate(candidate, [earlier, latest]);
    expect(scored.breakdown.directionCompatibility.raw).toBeGreaterThan(0.9);
    expect(scored.breakdown.directionCompatibility.detail).toContain('Positionsverlauf');
  });
});

describe('scoreSpeed', () => {
  const at = AT_1738;

  it('bewertet Stillstand als plausibel, aber nicht als Bestätigung', () => {
    const standing = observationBetween(
      FIXTURE_STOPS.zurichHb,
      FIXTURE_STOPS.zurichAltstetten,
      0.75,
      at,
      { speedMps: 0 },
    );
    const scored = scoreCandidate(buildCandidate(IC3_ZURICH_BASEL, standing), [standing]);
    expect(scored.breakdown.speedCompatibility.raw).toBeCloseTo(0.75, 2);
  });

  it('bewertet typische Reisegeschwindigkeit am besten', () => {
    const typical = observationBetween(
      FIXTURE_STOPS.zurichHb,
      FIXTURE_STOPS.zurichAltstetten,
      0.75,
      at,
      { speedMps: 75 / 3.6 },
    );
    const scored = scoreCandidate(buildCandidate(IC3_ZURICH_BASEL, typical), [typical]);
    expect(scored.breakdown.speedCompatibility.raw).toBeGreaterThan(0.98);
  });

  it('schliesst physikalisch unmögliche Geschwindigkeiten aus', () => {
    const tooFast = observationBetween(
      FIXTURE_STOPS.baselSbb,
      FIXTURE_STOPS.baselAeschenplatz,
      0.5,
      at,
      { speedMps: 200 / 3.6 },
    );
    const scored = scoreCandidate(buildCandidate(BUS_BASEL, tooFast), [tooFast]);
    expect(scored.breakdown.speedCompatibility.raw).toBe(0);
  });
});

describe('scoreStopSequence', () => {
  it('bestraft Bewegung entgegen der Fahrtrichtung', () => {
    const earlier = icObservation(AT_1736, 0.8);
    const latest = icObservation(AT_1738, 0.2);
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest, { previousObservation: earlier });
    const scored = scoreCandidate(candidate, [earlier, latest]);
    expect(scored.breakdown.stopSequence.raw).toBeLessThan(0.1);
  });

  it('belohnt konsistenten Fortschritt entlang der Linie', () => {
    const earlier = icObservation(AT_1736, 0.2);
    const latest = icObservation(AT_1738, 0.8);
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest, { previousObservation: earlier });
    const scored = scoreCandidate(candidate, [earlier, latest]);
    expect(scored.breakdown.stopSequence.raw).toBeGreaterThan(0.85);
  });
});

describe('scoreRealtime', () => {
  const latest = icObservation();

  it('schliesst ausgefallene Fahrten praktisch aus', () => {
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest, {
      realtimeDelaySeconds: null,
      cancelled: true,
    });
    const scored = scoreCandidate(candidate, [latest]);
    expect(scored.breakdown.realtimeCompatibility.raw).toBeLessThan(0.05);
    expect(scored.confidence).toBeLessThan(0.9);
  });

  it('nutzt den Neutralwert, wenn keine Echtzeitdaten vorliegen', () => {
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest);
    const scored = scoreCandidate(candidate, [latest]);
    expect(scored.breakdown.realtimeCompatibility.raw).toBeCloseTo(0.6, 5);
  });

  it('wertet aktuelle Echtzeitdaten positiv', () => {
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest, {
      realtimeDelaySeconds: 180,
      realtimeUpdatedAt: new Date(latest.timestamp.getTime() - 30_000),
    });
    const scored = scoreCandidate(candidate, [latest]);
    expect(scored.breakdown.realtimeCompatibility.raw).toBeGreaterThan(0.9);
  });
});

describe('Gewichtung', () => {
  it('normalisiert auch bei nicht auf 1 summierenden Gewichten auf 0..1', () => {
    const latest = icObservation();
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest);
    const scored = scoreCandidate(candidate, [latest], {
      shapeDistance: 3,
      timeCompatibility: 2.5,
      directionCompatibility: 1.5,
      speedCompatibility: 1,
      stopSequence: 1,
      realtimeCompatibility: 1,
    });
    const reference = scoreCandidate(candidate, [latest], DEFAULT_SCORE_WEIGHTS);
    expect(scored.confidence).toBeCloseTo(reference.confidence, 3);
    expect(scored.confidence).toBeLessThanOrEqual(1);
  });

  it('wirft ohne Beobachtung', () => {
    const latest = icObservation();
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest);
    expect(() => scoreCandidate(candidate, [])).toThrow();
  });
});

describe('decideDetection', () => {
  const make = (confidence: number) =>
    ({ confidence, candidate: {}, breakdown: {} }) as never;

  it('folgt den Schwellen aus §11', () => {
    expect(decideDetection([make(0.94)])).toBe('AUTO_SELECT');
    expect(decideDetection([make(0.82)])).toBe('CONFIRM');
    expect(decideDetection([make(0.55)])).toBe('CHOOSE');
    expect(decideDetection([])).toBe('NONE');
    expect(decideDetection([make(0.1)])).toBe('NONE');
  });

  it('fragt nach, wenn zwei Fahrten fast gleich gut passen', () => {
    expect(decideDetection([make(0.95), make(0.93)])).toBe('CONFIRM');
    expect(decideDetection([make(0.95), make(0.5)])).toBe('AUTO_SELECT');
  });

  it('respektiert angepasste Schwellen', () => {
    expect(decideDetection([make(0.8)], { auto: 0.75, confirm: 0.5 })).toBe('AUTO_SELECT');
    expect(decideDetection([make(0.8)], DEFAULT_DETECTION_THRESHOLDS)).toBe('CONFIRM');
  });
});

describe('Weitere Schweizer Szenarien (§49)', () => {
  it('erkennt ein Tram innerhalb Zürichs', () => {
    const at = new Date('2025-03-11T16:37:00Z'); // 17:37 lokal
    const latest = observationBetween(
      FIXTURE_STOPS.zurichBahnhofquai,
      FIXTURE_STOPS.zurichCentral,
      0.5,
      at,
      { speedMps: 18 / 3.6, accuracyMeters: 10 },
    );
    const earlier = observationBetween(
      FIXTURE_STOPS.zurichBahnhofquai,
      FIXTURE_STOPS.zurichCentral,
      0.1,
      new Date(at.getTime() - 40_000),
      { speedMps: 15 / 3.6 },
    );
    const scored = scoreCandidate(
      buildCandidate(TRAM_ZURICH, latest, { previousObservation: earlier }),
      [earlier, latest],
    );
    expect(scored.candidate.vehicleType).toBe(VehicleType.TRAM);
    expect(scored.confidence).toBeGreaterThan(0.7);
  });

  it('erkennt einen Bus in Basel', () => {
    const at = new Date('2025-03-11T16:37:00Z');
    const latest = observationBetween(
      FIXTURE_STOPS.baselSbb,
      FIXTURE_STOPS.baselAeschenplatz,
      0.6,
      at,
      { speedMps: 22 / 3.6 },
    );
    const scored = scoreCandidate(buildCandidate(BUS_BASEL, latest), [latest]);
    expect(scored.confidence).toBeGreaterThan(0.7);
  });

  it('erkennt ein PostAuto im ländlichen Raum trotz ungenauem GPS', () => {
    // Chur ab 17:30, Thusis an 18:05 → 45 % der Fahrzeit sind 17:45:45 lokal.
    const at = new Date('2025-03-11T16:45:45Z');
    const latest = observationBetween(FIXTURE_STOPS.chur, FIXTURE_STOPS.thusis, 0.45, at, {
      speedMps: 45 / 3.6,
      accuracyMeters: 90,
    });
    const scored = scoreCandidate(buildCandidate(POSTAUTO_RURAL, latest), [latest]);
    expect(scored.confidence).toBeGreaterThan(0.7);
  });

  it('erkennt IC 1 Bern → Zürich HB', () => {
    // Burgdorf ab 17:42, Olten an 18:00 → 55 % der Fahrzeit sind 17:51:54 lokal.
    const at = new Date('2025-03-11T16:51:54Z');
    const latest = observationBetween(FIXTURE_STOPS.burgdorf, FIXTURE_STOPS.olten, 0.55, at, {
      speedMps: 120 / 3.6,
      accuracyMeters: 20,
    });
    const scored = scoreCandidate(buildCandidate(IC1_BERN_ZURICH, latest), [latest]);
    expect(scored.confidence).toBeGreaterThan(0.75);
  });

  it('bewertet eine Fahrt, die noch gar nicht begonnen hat, deutlich schlechter', () => {
    // Gleiche Position, aber 40 Minuten vor der planmässigen Abfahrt in Bern.
    const at = new Date('2025-03-11T15:50:00Z');
    const latest = observationBetween(FIXTURE_STOPS.burgdorf, FIXTURE_STOPS.olten, 0.55, at, {
      speedMps: 120 / 3.6,
      accuracyMeters: 20,
    });
    const scored = scoreCandidate(buildCandidate(IC1_BERN_ZURICH, latest), [latest]);
    expect(scored.confidence).toBeLessThan(0.7);
  });
});
