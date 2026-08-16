import { describe, expect, it } from 'vitest';
import { WebPushError } from 'web-push';
import { classifyPushError, deepLinkFor } from './push.job.js';

/**
 * Tests des Web-Push-Versands (§24).
 *
 * Die Fehlerbehandlung ist hier der eigentliche Inhalt: Ein Push-Dienst
 * antwortet mit einem Statuscode, und aus diesem Code muss der Worker die
 * richtige Konsequenz ziehen. Wird ein abgemeldetes Gerät nicht entfernt,
 * scheitert der Versand bei jedem Durchlauf erneut — dauerhaft.
 */
function webPushError(statusCode: number): WebPushError {
  return new WebPushError('fehlgeschlagen', statusCode, {}, '', 'https://push.example/endpoint');
}

describe('classifyPushError', () => {
  it('behandelt 404 als endgültig — der Endpunkt existiert nicht mehr', () => {
    expect(classifyPushError(webPushError(404))).toMatchObject({ kind: 'GONE' });
  });

  it('behandelt 410 als endgültig — das Abo wurde abgemeldet', () => {
    expect(classifyPushError(webPushError(410))).toMatchObject({ kind: 'GONE' });
  });

  it('behandelt 413 als Programmierfehler, nicht als Netzproblem', () => {
    const outcome = classifyPushError(webPushError(413));
    expect(outcome.kind).toBe('PERMANENT');
    expect('reason' in outcome && outcome.reason).toContain('Nutzlast');
  });

  it('behandelt 401 und 403 als Konfigurationsfehler der VAPID-Schlüssel', () => {
    expect(classifyPushError(webPushError(401))).toMatchObject({ kind: 'PERMANENT' });
    expect(classifyPushError(webPushError(403))).toMatchObject({ kind: 'PERMANENT' });
  });

  it('wiederholt bei 429 (Rate Limit)', () => {
    expect(classifyPushError(webPushError(429))).toMatchObject({ kind: 'RETRY' });
  });

  it('wiederholt bei Serverfehlern des Push-Dienstes', () => {
    expect(classifyPushError(webPushError(500))).toMatchObject({ kind: 'RETRY' });
    expect(classifyPushError(webPushError(503))).toMatchObject({ kind: 'RETRY' });
  });

  it('wiederholt bei Netzwerkabbrüchen', () => {
    expect(classifyPushError(new Error('socket hang up'))).toMatchObject({ kind: 'RETRY' });
  });

  it('behandelt unbekannte 4xx-Codes als endgültig', () => {
    expect(classifyPushError(webPushError(400))).toMatchObject({ kind: 'PERMANENT' });
  });
});

describe('deepLinkFor', () => {
  it('führt zu einer Meldung, wenn eine Meldungs-ID vorliegt', () => {
    expect(deepLinkFor({ reportId: 'abc-123' })).toBe('/reports/abc-123');
  });

  it('bevorzugt die Meldung gegenüber der Fahrt — sie ist der konkretere Anlass', () => {
    expect(deepLinkFor({ reportId: 'abc-123', tripId: 'trip-1' })).toBe('/reports/abc-123');
  });

  it('führt zur Fahrt inklusive Betriebstag', () => {
    expect(deepLinkFor({ tripId: 'trip-1', serviceDate: '2025-03-11' })).toBe(
      '/trip/trip-1?serviceDate=2025-03-11',
    );
  });

  it('kodiert Sonderzeichen in GTFS-IDs', () => {
    // Schweizer GTFS-IDs enthalten Doppelpunkte und Bindestriche.
    expect(deepLinkFor({ tripId: '85:11:1234:001' })).toBe('/trip/85%3A11%3A1234%3A001');
  });

  it('führt zur Haltestelle, wenn nur diese bekannt ist', () => {
    expect(deepLinkFor({ stopId: '8503000' })).toBe('/stop/8503000');
  });

  it('führt im Zweifel zur Karte statt ins Leere', () => {
    expect(deepLinkFor({})).toBe('/map');
    expect(deepLinkFor({ reportId: 42 as unknown as string })).toBe('/map');
  });
});
