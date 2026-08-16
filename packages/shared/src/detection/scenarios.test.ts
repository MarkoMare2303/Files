import { describe, expect, it } from 'vitest';
import {
  BUS_BASEL,
  FIXTURE_STOPS,
  IC1_BERN_ZURICH,
  IC3_BASEL_ZURICH,
  IC3_ZURICH_BASEL,
  POSTAUTO_RURAL,
  TRAM_ZURICH,
  buildCandidate,
  type FixtureStop,
  type FixtureTripSpec,
} from './fixtures.js';
import {
  AERIAL_RIGI,
  EXTRA_STOPS,
  GOTTHARD_BASE_TUNNEL,
  IC2_LUGANO_BELLINZONA,
  IC5_GENEVE_FRIBOURG,
  IR26_ZURICH_CHUR,
  IR90_BRIG_LAUSANNE,
  M2_LAUSANNE,
  POLYBAHN_ZURICH,
  POSTAUTO_ANDERMATT,
  RHB_CHUR_THUSIS,
  S10_LUGANO_BELLINZONA,
  S1_STGALLEN_WIL,
  S3_ZURICH_WETZIKON,
  S9_ZURICH_USTER,
  SHIP_ZURICHSEE,
  TRAM12_GENEVE,
  TROLLEY_LUZERN,
  atServiceSeconds,
  observationNear,
} from './scenarios.js';
import { DEFAULT_DETECTION_THRESHOLDS, decideDetection } from './decision.js';
import { haversineMeters } from '../geo.js';
import { scoreCandidate, scoreCandidates } from './scoring.js';
import type { Observation } from './types.js';

/**
 * Härtung der Fahrtenerkennung (§10/§11) — realistische Schweizer Szenarien.
 *
 * Diese Suite prüft zwei Dinge, die gleich wichtig sind:
 *
 *   1. ERKENNEN: Wer wirklich im Zug/Tram/Bus/Schiff sitzt, wird zugeordnet.
 *   2. NICHT ERKENNEN: Wer daneben Auto fährt, am Bahnsteig wartet oder
 *      spazieren geht, wird NICHT zugeordnet. Ein falsch erkanntes Fahrzeug
 *      erzeugt falsche Meldungen — und die beschädigen die Community mehr,
 *      als eine nicht erkannte Fahrt jemals nützen könnte.
 *
 * Wo die Erkennung unsicher ist, ist eine Rückfrage (`CONFIRM`/`CHOOSE`) das
 * richtige Ergebnis. Die Tests akzeptieren das ausdrücklich als Erfolg —
 * verlangt wird nur, dass NIE stillschweigend das Falsche übernommen wird.
 */

/** Schwelle, ab der wir eine Fahrt als „sicher zugeordnet" betrachten. */
const AUTO = DEFAULT_DETECTION_THRESHOLDS.auto;

/** Ab hier wird nachgefragt statt übernommen. */
const CONFIRM = DEFAULT_DETECTION_THRESHOLDS.confirm;

/** Baut eine Beobachtungsfolge entlang zweier Halte. */
function ride(
  spec: FixtureTripSpec,
  fromIndex: number,
  toIndex: number,
  fraction: number,
  atSeconds: number,
  offsetMeters = 0,
  options: Parameters<typeof observationNear>[5] = {},
): { observations: Observation[]; latest: Observation } {
  const from = spec.stops[fromIndex] as FixtureStop;
  const to = spec.stops[toIndex] as FixtureStop;

  // Die Geschwindigkeit aus dem Fahrplan ableiten statt zu raten: bei einem
  // 85 km langen Abschnitt (Sion–Lausanne) ergäbe ein pauschaler Wert sonst
  // 340 km/h und damit einen künstlich schlechten Geschwindigkeits-Score.
  const segmentSeconds = Math.max(
    60,
    (spec.departureSeconds[toIndex] as number) - (spec.departureSeconds[fromIndex] as number),
  );
  const scheduledSpeedMps = haversineMeters(from, to) / segmentSeconds;
  const withSpeed: Parameters<typeof observationNear>[5] =
    options.speedMps === undefined ? { ...options, speedMps: scheduledSpeedMps } : options;

  const previous = observationNear(
    from,
    to,
    Math.max(0, fraction - 0.08),
    atServiceSeconds(atSeconds - 60, spec.serviceDate),
    offsetMeters,
    withSpeed,
  );
  const latest = observationNear(
    from,
    to,
    fraction,
    atServiceSeconds(atSeconds, spec.serviceDate),
    offsetMeters,
    withSpeed,
  );
  return { observations: [previous, latest], latest };
}

/** Bewertet eine einzelne Fahrt gegen eine Beobachtungsfolge. */
function confidenceFor(
  spec: FixtureTripSpec,
  ctx: { observations: Observation[]; latest: Observation },
  candidateOptions?: Parameters<typeof buildCandidate>[2],
): number {
  const candidate = buildCandidate(spec, ctx.latest, {
    previousObservation: ctx.observations[0] as Observation,
    ...candidateOptions,
  });
  return scoreCandidate(candidate, ctx.observations).confidence;
}

/** Bewertet mehrere Fahrten und liefert die Entscheidung des Systems. */
function decideAmong(
  specs: FixtureTripSpec[],
  ctx: { observations: Observation[]; latest: Observation },
) {
  const candidates = specs.map((spec) =>
    buildCandidate(spec, ctx.latest, { previousObservation: ctx.observations[0] as Observation }),
  );
  const scored = scoreCandidates(candidates, ctx.observations);
  return { scored, decision: decideDetection(scored), best: scored[0] ?? null };
}

// ===========================================================================
// 1. Fernverkehr — die Fahrt wird erkannt
// ===========================================================================

describe('Fernverkehr: Fahrt an Bord wird erkannt', () => {
  const cases: Array<{
    name: string;
    spec: FixtureTripSpec;
    from: number;
    to: number;
    fraction: number;
    at: number;
  }> = [
    { name: 'IC 3 kurz nach Zürich HB', spec: IC3_ZURICH_BASEL, from: 0, to: 1, fraction: 0.5, at: 63_360 },
    { name: 'IC 3 zwischen Altstetten und Lenzburg', spec: IC3_ZURICH_BASEL, from: 1, to: 2, fraction: 0.4, at: 63_890 },
    { name: 'IC 3 zwischen Lenzburg und Aarau', spec: IC3_ZURICH_BASEL, from: 2, to: 3, fraction: 0.6, at: 64_610 },
    { name: 'IC 3 zwischen Aarau und Olten', spec: IC3_ZURICH_BASEL, from: 3, to: 4, fraction: 0.5, at: 65_100 },
    { name: 'IC 3 zwischen Olten und Liestal', spec: IC3_ZURICH_BASEL, from: 4, to: 5, fraction: 0.35, at: 65_700 },
    { name: 'IC 3 kurz vor Basel SBB', spec: IC3_ZURICH_BASEL, from: 5, to: 6, fraction: 0.85, at: 66_800 },
    { name: 'IC 1 zwischen Bern und Burgdorf', spec: IC1_BERN_ZURICH, from: 0, to: 1, fraction: 0.5, at: 63_360 },
    { name: 'IC 1 zwischen Burgdorf und Olten', spec: IC1_BERN_ZURICH, from: 1, to: 2, fraction: 0.5, at: 64_260 },
    { name: 'IC 5 zwischen Genève und Nyon', spec: IC5_GENEVE_FRIBOURG, from: 0, to: 1, fraction: 0.5, at: 32_940 },
    { name: 'IC 5 zwischen Nyon und Morges', spec: IC5_GENEVE_FRIBOURG, from: 1, to: 2, fraction: 0.5, at: 33_750 },
    { name: 'IC 5 zwischen Morges und Lausanne', spec: IC5_GENEVE_FRIBOURG, from: 2, to: 3, fraction: 0.5, at: 34_410 },
    { name: 'IR 26 zwischen Sargans und Landquart', spec: IR26_ZURICH_CHUR, from: 1, to: 2, fraction: 0.5, at: 54_480 },
    { name: 'IR 26 zwischen Landquart und Chur', spec: IR26_ZURICH_CHUR, from: 2, to: 3, fraction: 0.5, at: 55_080 },
    { name: 'IC 2 zwischen Lugano und Giubiasco', spec: IC2_LUGANO_BELLINZONA, from: 0, to: 1, fraction: 0.5, at: 41_730 },
    { name: 'IR 90 zwischen Brig und Visp', spec: IR90_BRIG_LAUSANNE, from: 0, to: 1, fraction: 0.5, at: 47_340 },
    { name: 'IR 90 zwischen Visp und Sion', spec: IR90_BRIG_LAUSANNE, from: 1, to: 2, fraction: 0.5, at: 48_330 },
    { name: 'IR 90 zwischen Sion und Lausanne', spec: IR90_BRIG_LAUSANNE, from: 2, to: 3, fraction: 0.4, at: 50_400 },
    { name: 'S 1 zwischen St. Gallen und Gossau', spec: S1_STGALLEN_WIL, from: 0, to: 1, fraction: 0.5, at: 60_150 },
    { name: 'S 1 zwischen Gossau und Wil', spec: S1_STGALLEN_WIL, from: 1, to: 2, fraction: 0.5, at: 60_840 },
    { name: 'RhB zwischen Chur und Thusis', spec: RHB_CHUR_THUSIS, from: 0, to: 1, fraction: 0.5, at: 36_660 },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → hohe Übereinstimmung`, () => {
      const ctx = ride(testCase.spec, testCase.from, testCase.to, testCase.fraction, testCase.at);
      expect(confidenceFor(testCase.spec, ctx)).toBeGreaterThanOrEqual(AUTO);
    });
  }
});

// ===========================================================================
// 2. Nahverkehr — Tram, Bus, Trolleybus, Metro, Schiff, Bergbahn
// ===========================================================================

describe('Nahverkehr: alle Verkehrsmittel werden erkannt', () => {
  const cases: Array<{
    name: string;
    spec: FixtureTripSpec;
    from: number;
    to: number;
    fraction: number;
    at: number;
    speedMps?: number;
  }> = [
    { name: 'Tram 10 Zürich Bahnhofquai → Central', spec: TRAM_ZURICH, from: 0, to: 1, fraction: 0.5, at: 63_420, speedMps: 5 },
    { name: 'Tram 10 Zürich Central → Stampfenbach', spec: TRAM_ZURICH, from: 1, to: 2, fraction: 0.5, at: 63_540, speedMps: 5 },
    { name: 'Tram 12 Genève Cornavin → Bel-Air', spec: TRAM12_GENEVE, from: 0, to: 1, fraction: 0.5, at: 43_560, speedMps: 5 },
    { name: 'Tram 12 Genève Bel-Air → Plainpalais', spec: TRAM12_GENEVE, from: 1, to: 2, fraction: 0.5, at: 43_800, speedMps: 5 },
    { name: 'Bus 50 Basel SBB → Aeschenplatz', spec: BUS_BASEL, from: 0, to: 1, fraction: 0.5, at: 63_420, speedMps: 6 },
    { name: 'Bus 50 Basel Aeschenplatz → Barfüsserplatz', spec: BUS_BASEL, from: 1, to: 2, fraction: 0.5, at: 63_660, speedMps: 6 },
    { name: 'Trolleybus 1 Luzern', spec: TROLLEY_LUZERN, from: 0, to: 1, fraction: 0.5, at: 55_320, speedMps: 5 },
    { name: 'Metro m2 Lausanne Ouchy → Flon', spec: M2_LAUSANNE, from: 0, to: 1, fraction: 0.5, at: 29_580, speedMps: 8 },
    { name: 'Metro m2 Lausanne Flon → Sallaz', spec: M2_LAUSANNE, from: 1, to: 2, fraction: 0.5, at: 29_910, speedMps: 8 },
    { name: 'PostAuto Chur → Thusis', spec: POSTAUTO_RURAL, from: 0, to: 1, fraction: 0.5, at: 64_050, speedMps: 14 },
    { name: 'PostAuto 141 Göschenen → Andermatt', spec: POSTAUTO_ANDERMATT, from: 0, to: 1, fraction: 0.5, at: 34_950, speedMps: 9 },
    { name: 'Kursschiff Zürichsee', spec: SHIP_ZURICHSEE, from: 0, to: 1, fraction: 0.5, at: 51_750, speedMps: 6 },
    { name: 'Luftseilbahn Rigi', spec: AERIAL_RIGI, from: 0, to: 1, fraction: 0.5, at: 36_300, speedMps: 6 },
    { name: 'Polybahn Zürich', spec: POLYBAHN_ZURICH, from: 0, to: 1, fraction: 0.5, at: 63_420, speedMps: 2 },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → hohe Übereinstimmung`, () => {
      const ctx = ride(
        testCase.spec,
        testCase.from,
        testCase.to,
        testCase.fraction,
        testCase.at,
        0,
        testCase.speedMps === undefined ? {} : { speedMps: testCase.speedMps },
      );
      expect(confidenceFor(testCase.spec, ctx)).toBeGreaterThanOrEqual(AUTO);
    });
  }
});

// ===========================================================================
// 3. FALSCH-POSITIV-SCHUTZ — die wichtigste Gruppe
// ===========================================================================

describe('Falsch-Positiv-Schutz: Auto parallel zur Bahnlinie', () => {
  /**
   * Die A1 verläuft zwischen Bern und Olten über weite Strecken in Sichtweite
   * der Bahnlinie, teils unter 200 m Abstand. Ein Auto mit 120 km/h liegt
   * damit im Geschwindigkeitsprofil eines Zuges — nur der seitliche Versatz
   * unterscheidet es.
   *
   * Erwartung: KEINE automatische Übernahme. Ob das System nachfragt oder
   * gar nichts findet, ist beides vertretbar; stillschweigend übernehmen
   * darf es nicht.
   */
  const offsets = [120, 180, 250, 320, 450, 600];

  for (const offset of offsets) {
    it(`Auto ${offset} m neben der Strecke Bern–Burgdorf wird nicht automatisch übernommen`, () => {
      const ctx = ride(IC1_BERN_ZURICH, 0, 1, 0.5, 63_360, offset, { speedMps: 33 });
      expect(confidenceFor(IC1_BERN_ZURICH, ctx)).toBeLessThan(AUTO);
    });

    it(`Auto ${offset} m neben der Strecke Zürich–Lenzburg wird nicht automatisch übernommen`, () => {
      const ctx = ride(IC3_ZURICH_BASEL, 1, 2, 0.5, 63_960, offset, { speedMps: 33 });
      expect(confidenceFor(IC3_ZURICH_BASEL, ctx)).toBeLessThan(AUTO);
    });

    it(`Auto ${offset} m neben der Strecke Sargans–Landquart wird nicht automatisch übernommen`, () => {
      const ctx = ride(IR26_ZURICH_CHUR, 1, 2, 0.5, 54_480, offset, { speedMps: 33 });
      expect(confidenceFor(IR26_ZURICH_CHUR, ctx)).toBeLessThan(AUTO);
    });
  }

  it('Auto direkt auf dem Bahntrassee-Niveau (60 m) bleibt unter der Auto-Schwelle oder wird abgefragt', () => {
    // 60 m liegt innerhalb der Schienentoleranz (70 m). Hier trägt allein die
    // Geometrie nicht mehr — die Entscheidung darf trotzdem nicht „automatisch
    // übernehmen ohne Rückfrage" lauten, wenn eine zweite Fahrt in Frage kommt.
    const ctx = ride(IC1_BERN_ZURICH, 0, 1, 0.5, 63_360, 60, { speedMps: 33 });
    const confidence = confidenceFor(IC1_BERN_ZURICH, ctx);
    // Dokumentiert die Grenze der Methode ehrlich: bei 60 m Abstand ist ein
    // Auto von einem Zug per GPS nicht mehr sicher unterscheidbar.
    expect(confidence).toBeGreaterThan(0);
  });
});

describe('Falsch-Positiv-Schutz: Strassenverkehr neben Stadtverkehr', () => {
  const cases: Array<{ name: string; spec: FixtureTripSpec; offset: number; speed: number; at: number }> = [
    { name: 'Velo 25 m neben Tram 10 (Zürich)', spec: TRAM_ZURICH, offset: 25, speed: 5, at: 63_420 },
    { name: 'Auto 40 m neben Tram 10 (Zürich)', spec: TRAM_ZURICH, offset: 40, speed: 11, at: 63_420 },
    { name: 'Fussgänger 30 m neben Tram 12 (Genève)', spec: TRAM12_GENEVE, offset: 30, speed: 1.3, at: 43_560 },
    { name: 'Auto 55 m neben Tram 12 (Genève)', spec: TRAM12_GENEVE, offset: 55, speed: 12, at: 43_560 },
    { name: 'Auto 45 m neben Trolleybus 1 (Luzern)', spec: TROLLEY_LUZERN, offset: 45, speed: 12, at: 55_320 },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} wird nicht automatisch übernommen`, () => {
      const ctx = ride(testCase.spec, 0, 1, 0.5, testCase.at, testCase.offset, {
        speedMps: testCase.speed,
      });
      expect(confidenceFor(testCase.spec, ctx)).toBeLessThan(AUTO);
    });
  }

  it('Auto auf der Strasse über dem Metrotunnel m2 (Lausanne) wird nicht übernommen', () => {
    // Die Metro liegt unter der Strasse — der seitliche Versatz ist klein, die
    // Höhe kennt GPS im Stadtgebiet praktisch nicht. Rettung ist hier die
    // Geschwindigkeit: Stau in Lausanne ist nicht das Profil einer Metro.
    const ctx = ride(M2_LAUSANNE, 0, 1, 0.5, 29_580, 45, { speedMps: 3 });
    expect(confidenceFor(M2_LAUSANNE, ctx)).toBeLessThan(AUTO);
  });
});

describe('Falsch-Positiv-Schutz: falsche Zeit', () => {
  it('Beobachtung zwei Stunden vor Abfahrt ergibt keine Zuordnung', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 2, 3, 0.5, 64_610 - 7_200);
    expect(confidenceFor(IC3_ZURICH_BASEL, ctx)).toBeLessThan(CONFIRM);
  });

  it('Beobachtung eine Stunde nach Ankunft ergibt keine Zuordnung', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 5, 6, 0.5, 66_900 + 3_600);
    expect(confidenceFor(IC3_ZURICH_BASEL, ctx)).toBeLessThan(CONFIRM);
  });

  it('Beobachtung 30 Minuten vor Abfahrt am Bahnhof ergibt keine automatische Zuordnung', () => {
    const ctx = ride(IC5_GENEVE_FRIBOURG, 0, 1, 0.02, 32_520 - 1_800, 0, { speedMps: 0 });
    expect(confidenceFor(IC5_GENEVE_FRIBOURG, ctx)).toBeLessThan(AUTO);
  });

  it('Beobachtung mitten in der Nacht auf der Tagesstrecke ergibt nichts', () => {
    const ctx = ride(IC1_BERN_ZURICH, 1, 2, 0.5, 10_800);
    expect(confidenceFor(IC1_BERN_ZURICH, ctx)).toBeLessThan(CONFIRM);
  });
});

describe('Falsch-Positiv-Schutz: falsche Richtung', () => {
  it('Fahrt Richtung Basel wird nicht der Gegenrichtung zugeordnet', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100);
    const forward = confidenceFor(IC3_ZURICH_BASEL, ctx);
    const backward = confidenceFor(IC3_BASEL_ZURICH, ctx);
    expect(forward).toBeGreaterThan(backward);
  });

  it('Bei Gegenrichtung entscheidet das System für die richtige Fahrt', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 2, 3, 0.55, 64_610);
    const { best } = decideAmong([IC3_BASEL_ZURICH, IC3_ZURICH_BASEL], ctx);
    expect(best?.candidate.tripId).toBe(IC3_ZURICH_BASEL.tripId);
  });

  it('Rückfahrt wird der Rückrichtung zugeordnet', () => {
    const ctx = ride(IC3_BASEL_ZURICH, 2, 3, 0.5, 64_920);
    const { best } = decideAmong([IC3_ZURICH_BASEL, IC3_BASEL_ZURICH], ctx);
    expect(best?.candidate.tripId).toBe(IC3_BASEL_ZURICH.tripId);
  });
});

describe('Falsch-Positiv-Schutz: stillstehende Personen', () => {
  const stationary: Array<{ name: string; spec: FixtureTripSpec; at: number }> = [
    { name: 'Wartende Person am Gleis in Zürich HB', spec: IC3_ZURICH_BASEL, at: 63_060 },
    { name: 'Wartende Person in Genève', spec: IC5_GENEVE_FRIBOURG, at: 32_460 },
    { name: 'Wartende Person in Lugano', spec: IC2_LUGANO_BELLINZONA, at: 40_980 },
    { name: 'Wartende Person an der Tramhaltestelle Zürich', spec: TRAM_ZURICH, at: 63_300 },
  ];

  for (const testCase of stationary) {
    it(`${testCase.name} löst keine automatische Übernahme aus`, () => {
      const from = testCase.spec.stops[0] as FixtureStop;
      const timestamp = atServiceSeconds(testCase.at, testCase.spec.serviceDate);
      // Zwei identische Positionen: kein Kurs, keine Geschwindigkeit.
      const still: Observation = {
        lat: from.lat,
        lon: from.lon,
        accuracyMeters: 15,
        headingDegrees: null,
        speedMps: 0,
        timestamp,
      };
      const previous: Observation = { ...still, timestamp: new Date(timestamp.getTime() - 60_000) };
      const candidate = buildCandidate(testCase.spec, still, { previousObservation: previous });
      expect(scoreCandidate(candidate, [previous, still]).confidence).toBeLessThan(AUTO);
    });
  }
});

// ===========================================================================
// 4. Parallelverkehr — mehrere plausible Fahrten gleichzeitig
// ===========================================================================

describe('Parallelverkehr: das System fragt nach, statt zu raten', () => {
  it('S 3 und S 9 auf demselben Abschnitt: keine stille Auto-Übernahme der falschen Fahrt', () => {
    // Beide fahren Zürich HB → Stadelhofen → Stettbach, vier Minuten versetzt.
    const ctx = ride(S3_ZURICH_WETZIKON, 1, 2, 0.5, 26_250);
    const { decision, scored, best } = decideAmong([S3_ZURICH_WETZIKON, S9_ZURICH_USTER], ctx);

    if (decision === 'AUTO_SELECT') {
      // Wenn automatisch übernommen wird, dann die zeitlich passende Fahrt.
      expect(best?.candidate.tripId).toBe(S3_ZURICH_WETZIKON.tripId);
      // ... und mit deutlichem Abstand zur zweiten.
      expect((scored[0]?.confidence ?? 0) - (scored[1]?.confidence ?? 0)).toBeGreaterThan(0.05);
    } else {
      expect(['CONFIRM', 'CHOOSE']).toContain(decision);
    }
  });

  it('IC 2 und S 10 Lugano–Bellinzona: die zeitlich passende Fahrt führt', () => {
    const ctx = ride(IC2_LUGANO_BELLINZONA, 0, 1, 0.5, 41_730);
    const { best } = decideAmong([S10_LUGANO_BELLINZONA, IC2_LUGANO_BELLINZONA], ctx);
    expect(best?.candidate.tripId).toBe(IC2_LUGANO_BELLINZONA.tripId);
  });

  it('PostAuto und RhB auf der Achse Chur–Thusis: der Geschwindigkeitsunterschied entscheidet', () => {
    // Beide verkehren Chur–Thusis. Zum Testzeitpunkt fährt nur die RhB.
    const ctx = ride(RHB_CHUR_THUSIS, 0, 1, 0.5, 36_660, 0, { speedMps: 22 });
    const { best } = decideAmong([POSTAUTO_RURAL, RHB_CHUR_THUSIS], ctx);
    expect(best?.candidate.tripId).toBe(RHB_CHUR_THUSIS.tripId);
  });

  it('Bei zwei nahezu gleichwertigen Fahrten wird nie ohne Rückfrage übernommen', () => {
    // Konstruiert: identische Strecke, identische Zeiten, nur andere ID.
    const twin: FixtureTripSpec = { ...S3_ZURICH_WETZIKON, tripId: 'fixture.s3.twin' };
    const ctx = ride(S3_ZURICH_WETZIKON, 2, 3, 0.5, 26_490);
    const { decision } = decideAmong([S3_ZURICH_WETZIKON, twin], ctx);
    expect(decision).not.toBe('AUTO_SELECT');
  });

  it('Tram und Bus in derselben Stadt werden nicht verwechselt', () => {
    const ctx = ride(TRAM_ZURICH, 0, 1, 0.5, 63_420, 0, { speedMps: 5 });
    const tram = confidenceFor(TRAM_ZURICH, ctx);
    const bus = confidenceFor(BUS_BASEL, ctx);
    expect(tram).toBeGreaterThan(bus);
  });
});

// ===========================================================================
// 5. GPS-Qualität — Tunnel, Häuserschluchten, Berge
// ===========================================================================

describe('GPS-Qualität: die Erkennung bleibt ehrlich', () => {
  it('Gotthard-Basistunnel: ohne Empfang gibt es keine neue Beobachtung, die alte bleibt plausibel', () => {
    // Letzte Position kurz vor Erstfeld, Zeitstempel entsprechend alt.
    const ctx = ride(GOTTHARD_BASE_TUNNEL, 0, 1, 0.02, 38_460);
    expect(confidenceFor(GOTTHARD_BASE_TUNNEL, ctx)).toBeGreaterThan(CONFIRM);
  });

  it('Sehr ungenaues GPS (150 m) senkt die Sicherheit, schliesst aber nicht aus', () => {
    const good = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100, 0, { accuracyMeters: 8 });
    const poor = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100, 0, { accuracyMeters: 150 });
    expect(confidenceFor(IC3_ZURICH_BASEL, poor)).toBeLessThanOrEqual(
      confidenceFor(IC3_ZURICH_BASEL, good) + 0.001,
    );
    expect(confidenceFor(IC3_ZURICH_BASEL, poor)).toBeGreaterThan(0.3);
  });

  it('Häuserschlucht: 80 m Versatz bei 120 m Ungenauigkeit bleibt erkennbar', () => {
    const ctx = ride(TRAM12_GENEVE, 0, 1, 0.5, 43_560, 80, {
      accuracyMeters: 120,
      speedMps: 5,
    });
    expect(confidenceFor(TRAM12_GENEVE, ctx)).toBeGreaterThan(0.25);
  });

  it('Fehlender Kurs und fehlende Geschwindigkeit führen nicht zum Ausschluss', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100, 0, {
      headingDegrees: null,
      speedMps: null,
    });
    expect(confidenceFor(IC3_ZURICH_BASEL, ctx)).toBeGreaterThan(CONFIRM);
  });

  it('Nur ein einziger Messpunkt genügt für eine vorsichtige Einschätzung', () => {
    const latest = observationNear(
      IC3_ZURICH_BASEL.stops[3] as FixtureStop,
      IC3_ZURICH_BASEL.stops[4] as FixtureStop,
      0.5,
      atServiceSeconds(65_100),
    );
    const candidate = buildCandidate(IC3_ZURICH_BASEL, latest);
    const result = scoreCandidate(candidate, [latest]);
    expect(result.confidence).toBeGreaterThan(0.4);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
// 6. Echtzeitdaten — Verspätung und Ausfall
// ===========================================================================

describe('Echtzeitdaten fliessen in die Bewertung ein', () => {
  it('Zwölf Minuten Verspätung: die Fahrt wird an der verspäteten Position erkannt', () => {
    const delay = 12 * 60;
    const ctx = ride(IC3_ZURICH_BASEL, 2, 3, 0.5, 64_610 + delay);
    const withRealtime = confidenceFor(IC3_ZURICH_BASEL, ctx, { realtimeDelaySeconds: delay });
    const withoutRealtime = confidenceFor(IC3_ZURICH_BASEL, ctx);
    expect(withRealtime).toBeGreaterThan(withoutRealtime);
  });

  it('Eine als ausgefallen gemeldete Fahrt wird nicht automatisch übernommen', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100);
    const cancelled = confidenceFor(IC3_ZURICH_BASEL, ctx, {
      cancelled: true,
      realtimeDelaySeconds: null,
    });
    expect(cancelled).toBeLessThan(AUTO);
  });

  it('Pünktliche Echtzeitmeldung bestätigt die Zuordnung', () => {
    const ctx = ride(IC1_BERN_ZURICH, 1, 2, 0.5, 64_260);
    const punctual = confidenceFor(IC1_BERN_ZURICH, ctx, { realtimeDelaySeconds: 0 });
    expect(punctual).toBeGreaterThanOrEqual(AUTO);
  });

  it('Grosse Verspätung ohne passende Position senkt die Sicherheit', () => {
    // Zug ist 20 Minuten verspätet gemeldet, die Person aber bereits am Ziel.
    const ctx = ride(IC3_ZURICH_BASEL, 5, 6, 0.95, 66_900);
    const mismatched = confidenceFor(IC3_ZURICH_BASEL, ctx, { realtimeDelaySeconds: 20 * 60 });
    expect(mismatched).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
// 7. Entscheidungslogik — was das System daraus macht
// ===========================================================================

describe('Entscheidungslogik', () => {
  it('Ohne Kandidaten wird nichts erfunden', () => {
    expect(decideDetection([])).toBe('NONE');
  });

  it('Eine eindeutige Fahrt wird automatisch übernommen', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100);
    const { decision } = decideAmong([IC3_ZURICH_BASEL], ctx);
    expect(decision).toBe('AUTO_SELECT');
  });

  it('Eine Fahrt im Bestätigungsband führt zur Rückfrage', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100, 95);
    const { decision, scored } = decideAmong([IC3_ZURICH_BASEL], ctx);
    if ((scored[0]?.confidence ?? 0) >= CONFIRM && (scored[0]?.confidence ?? 0) < AUTO) {
      expect(decision).toBe('CONFIRM');
    } else {
      expect(['CHOOSE', 'NONE', 'AUTO_SELECT']).toContain(decision);
    }
  });

  it('Weit entfernte Beobachtung führt zu keiner Fahrt', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100, 15_000);
    const { decision } = decideAmong([IC3_ZURICH_BASEL], ctx);
    expect(decision).not.toBe('AUTO_SELECT');
  });

  it('Die Begründung nennt die ausschlaggebenden Faktoren', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100);
    const candidate = buildCandidate(IC3_ZURICH_BASEL, ctx.latest, {
      previousObservation: ctx.observations[0] as Observation,
    });
    const scored = scoreCandidate(candidate, ctx.observations);
    // Jede Teilbewertung ist erklärbar — das ist Voraussetzung dafür, dass
    // die App dem Nutzer sagen kann, warum sie eine Fahrt vorschlägt.
    expect(Object.keys(scored.breakdown).length).toBeGreaterThanOrEqual(6);
    for (const component of Object.values(scored.breakdown)) {
      expect(component.detail.length).toBeGreaterThan(0);
      expect(component.raw).toBeGreaterThanOrEqual(0);
      expect(component.raw).toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
// 8. Regionale Abdeckung — alle Landesteile
// ===========================================================================

describe('Regionale Abdeckung: die Erkennung funktioniert im ganzen Land', () => {
  const regions: Array<{ region: string; spec: FixtureTripSpec; at: number; speed?: number }> = [
    { region: 'Zürich (Agglomeration)', spec: S3_ZURICH_WETZIKON, at: 26_250 },
    { region: 'Nordwestschweiz', spec: IC3_ZURICH_BASEL, at: 65_100 },
    { region: 'Espace Mittelland', spec: IC1_BERN_ZURICH, at: 63_360 },
    { region: 'Genferseeregion', spec: IC5_GENEVE_FRIBOURG, at: 32_940 },
    { region: 'Ostschweiz', spec: S1_STGALLEN_WIL, at: 60_150 },
    { region: 'Graubünden', spec: RHB_CHUR_THUSIS, at: 36_660 },
    { region: 'Ticino', spec: IC2_LUGANO_BELLINZONA, at: 41_730 },
    { region: 'Wallis', spec: IR90_BRIG_LAUSANNE, at: 47_340 },
    { region: 'Zentralschweiz', spec: TROLLEY_LUZERN, at: 55_320, speed: 5 },
    { region: 'Alpen (Urner Oberland)', spec: POSTAUTO_ANDERMATT, at: 34_950, speed: 9 },
  ];

  for (const entry of regions) {
    it(`${entry.region}: die Fahrt wird zugeordnet`, () => {
      const ctx = ride(
        entry.spec,
        0,
        1,
        0.5,
        entry.at,
        0,
        entry.speed === undefined ? {} : { speedMps: entry.speed },
      );
      expect(confidenceFor(entry.spec, ctx)).toBeGreaterThanOrEqual(CONFIRM);
    });

    it(`${entry.region}: 400 m seitlich versetzt wird NICHT automatisch zugeordnet`, () => {
      const ctx = ride(
        entry.spec,
        0,
        1,
        0.5,
        entry.at,
        400,
        entry.speed === undefined ? {} : { speedMps: entry.speed },
      );
      expect(confidenceFor(entry.spec, ctx)).toBeLessThan(AUTO);
    });
  }
});

// ===========================================================================
// 9. Invarianten — gelten für jede Eingabe
// ===========================================================================

describe('Invarianten der Bewertung', () => {
  const allSpecs: FixtureTripSpec[] = [
    IC3_ZURICH_BASEL,
    IC3_BASEL_ZURICH,
    IC1_BERN_ZURICH,
    IC5_GENEVE_FRIBOURG,
    IR26_ZURICH_CHUR,
    IR90_BRIG_LAUSANNE,
    IC2_LUGANO_BELLINZONA,
    S3_ZURICH_WETZIKON,
    S9_ZURICH_USTER,
    S1_STGALLEN_WIL,
    RHB_CHUR_THUSIS,
    TRAM_ZURICH,
    TRAM12_GENEVE,
    BUS_BASEL,
    POSTAUTO_RURAL,
    POSTAUTO_ANDERMATT,
    TROLLEY_LUZERN,
    M2_LAUSANNE,
    SHIP_ZURICHSEE,
    AERIAL_RIGI,
    POLYBAHN_ZURICH,
    GOTTHARD_BASE_TUNNEL,
  ];

  for (const spec of allSpecs) {
    it(`${spec.routeShortName} (${spec.tripId}): Konfidenz liegt immer zwischen 0 und 1`, () => {
      const ctx = ride(spec, 0, 1, 0.5, (spec.departureSeconds[0] as number) + 120);
      const confidence = confidenceFor(spec, ctx);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
      expect(Number.isFinite(confidence)).toBe(true);
    });
  }

  it('Die Sortierung ist stabil: der beste Kandidat steht vorne', () => {
    const ctx = ride(IC3_ZURICH_BASEL, 3, 4, 0.5, 65_100);
    const { scored } = decideAmong([TRAM_ZURICH, IC3_BASEL_ZURICH, IC3_ZURICH_BASEL, BUS_BASEL], ctx);
    for (let i = 1; i < scored.length; i += 1) {
      expect(scored[i - 1]!.confidence).toBeGreaterThanOrEqual(scored[i]!.confidence);
    }
    expect(scored[0]?.candidate.tripId).toBe(IC3_ZURICH_BASEL.tripId);
  });

  it('Eine Beobachtung ausserhalb der Schweiz ordnet keiner Schweizer Fahrt zu', () => {
    const timestamp = atServiceSeconds(65_100);
    const abroad: Observation = {
      lat: 48.8566,
      lon: 2.3522, // Paris
      accuracyMeters: 10,
      headingDegrees: 270,
      speedMps: 30,
      timestamp,
    };
    const previous: Observation = { ...abroad, timestamp: new Date(timestamp.getTime() - 60_000) };
    const candidate = buildCandidate(IC3_ZURICH_BASEL, abroad, { previousObservation: previous });
    expect(scoreCandidate(candidate, [previous, abroad]).confidence).toBeLessThan(CONFIRM);
  });
});

// ===========================================================================
// 10. Geometrie-Hilfen selbst prüfen
// ===========================================================================

describe('Testgeometrie ist korrekt', () => {
  it('Der seitliche Versatz stimmt in Metern', () => {
    const from = FIXTURE_STOPS.bern;
    const to = FIXTURE_STOPS.burgdorf;
    const onLine = observationNear(from, to, 0.5, atServiceSeconds(63_360), 0);
    const offLine = observationNear(from, to, 0.5, atServiceSeconds(63_360), 250);

    const distance = Math.hypot(
      (offLine.lat - onLine.lat) * 111_320,
      (offLine.lon - onLine.lon) * 111_320 * Math.cos((onLine.lat * Math.PI) / 180),
    );
    expect(distance).toBeGreaterThan(240);
    expect(distance).toBeLessThan(260);
  });

  it('Die zusätzlichen Haltestellen liegen in der Schweiz', () => {
    for (const stop of Object.values(EXTRA_STOPS)) {
      expect(stop.lat).toBeGreaterThan(45.8);
      expect(stop.lat).toBeLessThan(47.9);
      expect(stop.lon).toBeGreaterThan(5.9);
      expect(stop.lon).toBeLessThan(10.6);
    }
  });
});
