import { describe, expect, it } from 'vitest';
import { routePattern, sanitizeEvent, startVitals } from './vitals';

/**
 * Tests der Messdaten-Bereinigung (§23/§53).
 *
 * Der Zweck dieser Tests ist nicht, Performance zu messen, sondern zu
 * verhindern, dass beim Messen versehentlich Standort- oder Kontodaten
 * abfliessen. Ein Analytics-Beacon mit `?lat=47.37&lon=8.54` wäre genau die
 * Bewegungshistorie, die das Produkt ausdrücklich nicht speichert.
 */
describe('routePattern', () => {
  it('ersetzt die Fahrt-ID durch ihr Muster', () => {
    expect(routePattern('/trip/85:11:1234')).toBe('/trip/[tripId]');
  });

  it('entfernt Suchparameter — dort steht der Betriebstag', () => {
    expect(routePattern('/trip/85:11:1234?serviceDate=2025-03-11')).toBe('/trip/[tripId]');
  });

  it('ersetzt Meldungs- und Haltestellen-IDs', () => {
    expect(routePattern('/reports/9f8e7d6c-1111-4222-8333-444455556666')).toBe(
      '/reports/[reportId]',
    );
    expect(routePattern('/stop/8503000')).toBe('/stop/[stopId]');
  });

  it('lässt Routen ohne identifizierende Angaben unverändert', () => {
    expect(routePattern('/map')).toBe('/map');
    expect(routePattern('/settings')).toBe('/settings');
  });
});

describe('sanitizeEvent', () => {
  it('entfernt Koordinaten auf jeder Verschachtelungsebene', () => {
    const cleaned = sanitizeEvent({
      context: { position: { lat: 47.3779, lon: 8.5403, accuracy: 12 } },
      observations: [{ lat: 47.3, lon: 8.5 }],
    });

    const json = JSON.stringify(cleaned);
    expect(json).not.toContain('47.3779');
    expect(json).not.toContain('8.5403');
    expect(json).toContain('[entfernt]');
  });

  it('entfernt Token, E-Mail-Adresse und Installations-ID', () => {
    const cleaned = sanitizeEvent({
      accessToken: 'geheim',
      user: { email: 'person@example.ch' },
      installId: '11111111-2222-4333-8444-555555555555',
    });

    const json = JSON.stringify(cleaned);
    expect(json).not.toContain('geheim');
    expect(json).not.toContain('person@example.ch');
    expect(json).not.toContain('11111111');
  });

  it('reduziert URLs in Freitexten auf ihr Routenmuster', () => {
    const cleaned = sanitizeEvent({
      message: 'Fehler beim Laden von /trip/85:11:1234 und /reports/abc-def',
    });
    expect(cleaned.message).toBe('Fehler beim Laden von /trip/[tripId] und /reports/[reportId]');
  });

  it('lässt harmlose Angaben unverändert', () => {
    const cleaned = sanitizeEvent({ name: 'LCP', value: 1234, route: '/map' });
    expect(cleaned).toEqual({ name: 'LCP', value: 1234, route: '/map' });
  });
});

describe('startVitals', () => {
  it('misst ohne Einwilligung gar nichts', () => {
    let called = false;
    const stop = startVitals(() => {
      called = true;
    }, { enabled: false });

    stop();
    expect(called).toBe(false);
  });
});
