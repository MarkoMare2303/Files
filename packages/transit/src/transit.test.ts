import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { VehicleType } from '@swissov/types';
import { backoffDelayMs, parseRetryAfter } from './http.js';
import { formatCopyRow, pointEwkt } from './gtfs/copy.js';
import { gtfsBoolean, gtfsFloat, gtfsInt, readCsv } from './gtfs/csv.js';
import { buildTripRequestXml, parseIso8601Duration, parseTripResponse } from './journey/ojp.js';
import { translationsToJson } from './realtime/gtfs-rt.js';
import { OJP_TRIP_RESPONSE_FIXTURE } from './journey/fixtures/ojp-trip-response.js';

describe('HTTP-Backoff', () => {
  it('wächst exponentiell und bleibt begrenzt', () => {
    const first = backoffDelayMs(0, 500);
    const third = backoffDelayMs(2, 500);
    expect(first).toBeGreaterThanOrEqual(500);
    expect(third).toBeGreaterThan(first);
    expect(backoffDelayMs(20, 500)).toBeLessThanOrEqual(30_000 * 1.25 + 1);
  });

  it('interpretiert Retry-After als Sekunden', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('interpretiert Retry-After als HTTP-Datum', () => {
    const now = new Date('2025-03-11T17:00:00Z');
    expect(parseRetryAfter('Tue, 11 Mar 2025 17:00:30 GMT', now)).toBe(30_000);
  });

  it('gibt bei fehlendem oder ungültigem Header null zurück', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('bald')).toBeNull();
  });
});

describe('COPY-Formatierung', () => {
  it('quotet Werte und escaped Anführungszeichen', () => {
    expect(formatCopyRow(['Zürich HB', 42, true])).toBe('"Zürich HB","42","true"\n');
    expect(formatCopyRow(['Say "hi"'])).toBe('"Say ""hi"""\n');
  });

  it('unterscheidet NULL von leerem String', () => {
    // Unquotiert leer = NULL, quotiert leer = leerer String (PostgreSQL-CSV-Semantik)
    expect(formatCopyRow([null, ''])).toBe(',""\n');
    expect(formatCopyRow([undefined])).toBe('\n');
  });

  it('schützt vor Zeilenumbrüchen in Werten', () => {
    // Quotierte Felder dürfen Zeilenumbrüche enthalten; COPY parst sie korrekt.
    expect(formatCopyRow(['a\nb'])).toBe('"a\nb"\n');
  });

  it('erzeugt gültiges EWKT', () => {
    expect(pointEwkt(8.5403, 47.3779)).toBe('SRID=4326;POINT(8.5403 47.3779)');
  });
});

describe('GTFS-CSV-Leser', () => {
  const csv = [
    'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
    '8503000,Zürich HB,47.3779,8.5403,1,',
    '8503000:0:32,"Zürich HB, Gleis 32",47.3781,8.5406,0,8503000',
  ].join('\n');

  it('liest Spalten über den Namen, unabhängig von der Reihenfolge', async () => {
    const rows = [];
    for await (const row of readCsv(Readable.from([csv]))) rows.push(row);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.get('stop_name')).toBe('Zürich HB');
    expect(rows[1]!.get('stop_name')).toBe('Zürich HB, Gleis 32');
    expect(rows[1]!.get('parent_station')).toBe('8503000');
  });

  it('gibt für leere Felder null zurück', async () => {
    const rows = [];
    for await (const row of readCsv(Readable.from([csv]))) rows.push(row);
    expect(rows[0]!.get('parent_station')).toBeNull();
    expect(rows[0]!.get('gibt_es_nicht')).toBeNull();
  });

  it('wirft bei fehlendem Pflichtfeld mit Zeilenangabe', async () => {
    const rows = [];
    for await (const row of readCsv(Readable.from([csv]))) rows.push(row);
    expect(() => rows[0]!.getRequired('platform_code')).toThrow(/Zeile 2/);
  });

  it('entfernt ein BOM aus der Kopfzeile', async () => {
    const withBom = `﻿${csv}`;
    const rows = [];
    for await (const row of readCsv(Readable.from([withBom]))) rows.push(row);
    expect(rows[0]!.get('stop_id')).toBe('8503000');
  });
});

describe('GTFS-Wertkonvertierung', () => {
  it('konvertiert 0/1 in boolean', () => {
    expect(gtfsBoolean('1')).toBe(true);
    expect(gtfsBoolean('0')).toBe(false);
    expect(gtfsBoolean(null)).toBe(false);
  });

  it('nutzt Fallbacks statt stillschweigend 0 zu liefern', () => {
    expect(gtfsInt(null, 3)).toBe(3);
    expect(gtfsInt('keine Zahl', 3)).toBe(3);
    expect(gtfsInt('7', 3)).toBe(7);
    expect(gtfsFloat('47.3779')).toBeCloseTo(47.3779, 6);
    expect(gtfsFloat(null)).toBeNull();
  });
});

describe('OJP-Anfrage', () => {
  it('erzeugt ein gültiges TripRequest-Dokument', () => {
    const xml = buildTripRequestXml(
      {
        originStopId: '8503000',
        destinationStopId: '8500010',
        at: new Date('2025-03-11T16:30:00Z'),
        timeMode: 'DEPARTURE',
        results: 4,
        locale: 'de',
      },
      'swissov-live',
      new Date('2025-03-11T16:29:00Z'),
    );
    expect(xml).toContain('<OJPTripRequest>');
    expect(xml).toContain('<StopPlaceRef>8503000</StopPlaceRef>');
    expect(xml).toContain('<StopPlaceRef>8500010</StopPlaceRef>');
    expect(xml).toContain('<DepArrTime>2025-03-11T16:30:00Z</DepArrTime>');
    expect(xml).toContain('<NumberOfResults>4</NumberOfResults>');
    expect(xml).toContain('<siri:RequestorRef>swissov-live</siri:RequestorRef>');
  });

  it('nutzt ArrArrTime-Semantik bei Ankunftssuche', () => {
    const xml = buildTripRequestXml(
      {
        originStopId: 'a',
        destinationStopId: 'b',
        at: new Date('2025-03-11T16:30:00Z'),
        timeMode: 'ARRIVAL',
      },
      'ref',
    );
    expect(xml).toContain('<ArrArrTime>');
  });

  it('escaped Sonderzeichen in Haltestellen-IDs', () => {
    const xml = buildTripRequestXml(
      {
        originStopId: 'a&b<c>',
        destinationStopId: 'x"y',
        at: new Date(),
        timeMode: 'DEPARTURE',
      },
      'ref',
    );
    expect(xml).toContain('a&amp;b&lt;c&gt;');
    expect(xml).toContain('x&quot;y');
  });
});

describe('OJP-Antwort-Parser', () => {
  const journeys = parseTripResponse(OJP_TRIP_RESPONSE_FIXTURE);

  it('liest beide Verbindungen', () => {
    expect(journeys).toHaveLength(2);
  });

  it('übernimmt Echtzeitzeiten und berechnet die Verspätung', () => {
    const direct = journeys[0]!;
    expect(direct.legs).toHaveLength(1);
    const leg = direct.legs[0]!;
    expect(leg.routeShortName).toBe('IC 3');
    expect(leg.vehicleType).toBe(VehicleType.RAIL);
    expect(leg.origin.name).toBe('Zürich HB');
    expect(leg.origin.platformCode).toBe('32');
    expect(leg.destination.name).toBe('Basel SBB');
    // Prognose 16:35 statt 16:32 → 180 s Verspätung
    expect(leg.departureDelaySeconds).toBe(180);
    expect(leg.departure).toBe('2025-03-11T16:35:00.000Z');
    expect(direct.transfers).toBe(0);
  });

  it('liest Zwischenhalte', () => {
    expect(journeys[0]!.legs[0]!.intermediateStops.map((s) => s.name)).toEqual(['Olten']);
  });

  it('erkennt Umstiegsverbindungen inkl. Fussweg', () => {
    const withTransfer = journeys[1]!;
    expect(withTransfer.legs).toHaveLength(3);
    expect(withTransfer.legs[1]!.mode).toBe('WALK');
    expect(withTransfer.legs[1]!.durationSeconds).toBe(360);
    expect(withTransfer.transfers).toBe(1);
  });

  it('berechnet die Gesamtdauer aus erster Abfahrt und letzter Ankunft', () => {
    // 16:58 → 17:58 = 3600 s
    expect(journeys[1]!.durationSeconds).toBe(3600);
  });

  it('liefert bei leerer oder fremder Antwort ein leeres Ergebnis', () => {
    expect(parseTripResponse('<OJP></OJP>')).toEqual([]);
  });
});

describe('parseIso8601Duration', () => {
  it('parst Stunden, Minuten und Sekunden', () => {
    expect(parseIso8601Duration('PT1H20M')).toBe(4800);
    expect(parseIso8601Duration('PT45S')).toBe(45);
    expect(parseIso8601Duration('P1DT2H')).toBe(93_600);
  });

  it('gibt bei ungültigem Format null zurück', () => {
    expect(parseIso8601Duration('20 Minuten')).toBeNull();
  });
});

describe('GTFS-RT-Übersetzungen', () => {
  it('wandelt TranslatedString in ein Sprachobjekt', () => {
    const result = translationsToJson({
      translation: [
        { language: 'de', text: 'Streckenunterbruch' },
        { language: 'fr', text: 'Interruption' },
        { language: 'en-GB', text: 'Interruption' },
      ],
    });
    expect(result).toEqual({ de: 'Streckenunterbruch', fr: 'Interruption', en: 'Interruption' });
  });

  it('setzt Deutsch als Fallback, wenn nur andere Sprachen vorliegen', () => {
    const result = translationsToJson({ translation: [{ language: 'fr', text: 'Retard' }] });
    expect(result).toEqual({ fr: 'Retard', de: 'Retard' });
  });

  it('gibt bei fehlenden Übersetzungen null zurück', () => {
    expect(translationsToJson(null)).toBeNull();
    expect(translationsToJson({ translation: [] })).toBeNull();
  });
});
