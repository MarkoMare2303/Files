import { describe, expect, it } from 'vitest';
import { errorKeyFor, isGeolocationSupported, toObservation } from './useLocation';

/**
 * Tests der Standort-Umwandlung (§59/§60).
 *
 * Browser liefern für unbekannte Werte `null` — nicht `-1` wie native
 * Plattformen. Ein als `0` interpretiertes „unbekannt" würde bedeuten:
 * „steht still" — und damit die Fahrterkennung systematisch verfälschen.
 */
function position(coords: Partial<GeolocationCoordinates>, timestamp = 1_700_000_000_000) {
  return {
    coords: {
      latitude: 47.3779,
      longitude: 8.5403,
      accuracy: 12,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...coords,
    },
    timestamp,
  } as GeolocationPosition;
}

describe('toObservation', () => {
  it('übernimmt Position und Zeitstempel', () => {
    const observation = toObservation(position({}));
    expect(observation.lat).toBeCloseTo(47.3779, 4);
    expect(observation.lon).toBeCloseTo(8.5403, 4);
    expect(observation.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('lässt eine unbekannte Geschwindigkeit weg, statt 0 zu behaupten', () => {
    const observation = toObservation(position({ speed: null }));
    expect(observation.speed).toBeUndefined();
  });

  it('übernimmt eine gemessene Geschwindigkeit', () => {
    const observation = toObservation(position({ speed: 27.5 }));
    expect(observation.speed).toBe(27.5);
  });

  it('verwirft negative Geschwindigkeiten', () => {
    const observation = toObservation(position({ speed: -1 }));
    expect(observation.speed).toBeUndefined();
  });

  it('verwirft NaN-Werte, die manche Browser bei stehendem Gerät liefern', () => {
    const observation = toObservation(position({ speed: Number.NaN, heading: Number.NaN }));
    expect(observation.speed).toBeUndefined();
    expect(observation.heading).toBeUndefined();
  });

  it('lässt einen unbekannten Kurs weg', () => {
    const observation = toObservation(position({ heading: null }));
    expect(observation.heading).toBeUndefined();
  });

  it('übernimmt einen gemessenen Kurs', () => {
    const observation = toObservation(position({ heading: 271.5 }));
    expect(observation.heading).toBe(271.5);
  });

  it('begrenzt eine negative Genauigkeit auf 0', () => {
    const observation = toObservation(position({ accuracy: -5 }));
    expect(observation.accuracy).toBe(0);
  });
});

describe('errorKeyFor', () => {
  it('unterscheidet Ablehnung, Nichtverfügbarkeit und Zeitüberschreitung', () => {
    expect(errorKeyFor({ code: 1 })).toBe('location.denied');
    expect(errorKeyFor({ code: 2 })).toBe('location.unavailable');
    expect(errorKeyFor({ code: 3 })).toBe('location.timeout');
  });

  it('fällt bei unbekannten Codes auf eine allgemeine Meldung zurück', () => {
    expect(errorKeyFor({ code: 99 })).toBe('error.generic');
  });
});

describe('isGeolocationSupported', () => {
  it('erkennt die Verfügbarkeit im Testbrowser', () => {
    expect(typeof isGeolocationSupported()).toBe('boolean');
  });
});
