import { describe, expect, it } from 'vitest';
import { VehicleType, vehicleTypeFromRouteType, VEHICLE_SPEED_PROFILE } from './enums.js';
import { SWITZERLAND_BBOX, pickLocalized } from './common.js';
import { createReportInputSchema, reportCategorySchema } from './reports.js';
import { tripDetectionRequestSchema } from './detection.js';
import { runtimeConfigSchema } from './admin.js';

describe('vehicleTypeFromRouteType', () => {
  it('bildet die GTFS-Basistypen ab', () => {
    expect(vehicleTypeFromRouteType(0)).toBe(VehicleType.TRAM);
    expect(vehicleTypeFromRouteType(1)).toBe(VehicleType.SUBWAY);
    expect(vehicleTypeFromRouteType(2)).toBe(VehicleType.RAIL);
    expect(vehicleTypeFromRouteType(3)).toBe(VehicleType.BUS);
    expect(vehicleTypeFromRouteType(7)).toBe(VehicleType.FUNICULAR);
  });

  it('bildet die erweiterten Typen des Schweizer Feeds ab', () => {
    // 102 = Long Distance Train (IC/IR), 900 = Tram Service, 700 = Bus Service
    expect(vehicleTypeFromRouteType(102)).toBe(VehicleType.RAIL);
    expect(vehicleTypeFromRouteType(900)).toBe(VehicleType.TRAM);
    expect(vehicleTypeFromRouteType(700)).toBe(VehicleType.BUS);
    expect(vehicleTypeFromRouteType(800)).toBe(VehicleType.TROLLEYBUS);
    expect(vehicleTypeFromRouteType(1400)).toBe(VehicleType.FUNICULAR);
    expect(vehicleTypeFromRouteType(1300)).toBe(VehicleType.AERIAL_LIFT);
    expect(vehicleTypeFromRouteType(1000)).toBe(VehicleType.FERRY);
  });

  it('liefert für unbekannte oder fehlende Werte UNKNOWN', () => {
    expect(vehicleTypeFromRouteType(null)).toBe(VehicleType.UNKNOWN);
    expect(vehicleTypeFromRouteType(undefined)).toBe(VehicleType.UNKNOWN);
    expect(vehicleTypeFromRouteType(Number.NaN)).toBe(VehicleType.UNKNOWN);
    expect(vehicleTypeFromRouteType(9999)).toBe(VehicleType.UNKNOWN);
  });
});

describe('VEHICLE_SPEED_PROFILE', () => {
  it('deckt jeden Fahrzeugtyp mit plausiblen Werten ab', () => {
    for (const type of Object.values(VehicleType)) {
      const profile = VEHICLE_SPEED_PROFILE[type];
      expect(profile).toBeDefined();
      expect(profile.typical).toBeGreaterThan(0);
      expect(profile.max).toBeGreaterThan(profile.typical);
    }
  });

  it('bildet die Realität ab: Bahn schneller als Tram', () => {
    expect(VEHICLE_SPEED_PROFILE[VehicleType.RAIL].max).toBeGreaterThan(
      VEHICLE_SPEED_PROFILE[VehicleType.TRAM].max,
    );
  });
});

describe('SWITZERLAND_BBOX', () => {
  it('umschliesst die Eckpunkte des Landes', () => {
    const inside = (lat: number, lon: number): boolean =>
      lat >= SWITZERLAND_BBOX.minLat &&
      lat <= SWITZERLAND_BBOX.maxLat &&
      lon >= SWITZERLAND_BBOX.minLon &&
      lon <= SWITZERLAND_BBOX.maxLon;

    expect(inside(47.3779, 8.5403)).toBe(true); // Zürich
    expect(inside(46.2044, 6.1432)).toBe(true); // Genf
    expect(inside(46.0037, 8.9511)).toBe(true); // Lugano
    expect(inside(47.5596, 7.5886)).toBe(true); // Basel
    expect(inside(48.8566, 2.3522)).toBe(false); // Paris
    expect(inside(52.52, 13.405)).toBe(false); // Berlin
  });
});

describe('pickLocalized', () => {
  const text = { de: 'Verspätung', fr: 'Retard', it: 'Ritardo' };

  it('wählt die passende Sprache', () => {
    expect(pickLocalized(text, 'fr')).toBe('Retard');
  });

  it('fällt auf Deutsch zurück', () => {
    expect(pickLocalized(text, 'en')).toBe('Verspätung');
    expect(pickLocalized(text, undefined)).toBe('Verspätung');
    expect(pickLocalized(text, 'unsinn')).toBe('Verspätung');
  });
});

describe('createReportInputSchema', () => {
  it('akzeptiert eine Meldung mit Fahrtbezug', () => {
    const result = createReportInputSchema.safeParse({
      categoryKey: 'high_occupancy',
      tripId: 't-1',
    });
    expect(result.success).toBe(true);
  });

  it('lehnt eine Meldung ganz ohne Bezug ab', () => {
    const result = createReportInputSchema.safeParse({ categoryKey: 'high_occupancy' });
    expect(result.success).toBe(false);
  });

  it('begrenzt die Nachrichtenlänge', () => {
    const result = createReportInputSchema.safeParse({
      categoryKey: 'other',
      stopId: '8503000',
      message: 'x'.repeat(281),
    });
    expect(result.success).toBe(false);
  });

  it('weist unplausible Koordinaten zurück', () => {
    expect(
      createReportInputSchema.safeParse({ categoryKey: 'other', lat: 95, lon: 8 }).success,
    ).toBe(false);
  });
});

describe('tripDetectionRequestSchema', () => {
  const observation = {
    lat: 47.3779,
    lon: 8.5403,
    timestamp: '2025-03-11T16:38:00.000Z',
  };

  it('verlangt mindestens eine Beobachtung', () => {
    expect(tripDetectionRequestSchema.safeParse({ observations: [] }).success).toBe(false);
  });

  it('begrenzt die Anzahl übertragener Punkte (Datensparsamkeit)', () => {
    const many = Array.from({ length: 11 }, () => observation);
    expect(tripDetectionRequestSchema.safeParse({ observations: many }).success).toBe(false);
  });

  it('setzt eine Standardanzahl an Ergebnissen', () => {
    const parsed = tripDetectionRequestSchema.parse({ observations: [observation] });
    expect(parsed.limit).toBe(5);
  });
});

describe('reportCategorySchema', () => {
  it('verlangt eine gültige Hex-Farbe', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      key: 'test_key',
      label: { de: 'Test' },
      description: null,
      icon: 'x',
      group: 'OTHER' as const,
      defaultScope: 'STOP' as const,
      allowedScopes: ['STOP' as const],
      ttlSeconds: 600,
      ttlUntilTripEnd: false,
      requiresTrip: false,
      requiresModeration: false,
      severity: 'LOW' as const,
      sortOrder: 1,
      active: true,
    };
    expect(reportCategorySchema.safeParse({ ...base, color: '#AABBCC' }).success).toBe(true);
    expect(reportCategorySchema.safeParse({ ...base, color: 'rot' }).success).toBe(false);
  });
});

describe('runtimeConfigSchema', () => {
  it('weist Schwellen ausserhalb des gültigen Bereichs zurück', () => {
    const detection = runtimeConfigSchema.shape.detection;
    const valid = {
      autoThreshold: 0.9,
      confirmThreshold: 0.7,
      defaultRadiusMeters: 1200,
      maxCandidates: 8,
      weights: {
        shapeDistance: 0.3,
        timeCompatibility: 0.25,
        directionCompatibility: 0.15,
        speedCompatibility: 0.1,
        stopSequence: 0.1,
        realtimeCompatibility: 0.1,
      },
    };
    expect(detection.safeParse(valid).success).toBe(true);
    expect(detection.safeParse({ ...valid, autoThreshold: 1.5 }).success).toBe(false);
    expect(detection.safeParse({ ...valid, defaultRadiusMeters: 99_999 }).success).toBe(false);
  });
});
