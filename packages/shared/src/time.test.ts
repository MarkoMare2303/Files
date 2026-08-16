import { describe, expect, it } from 'vitest';
import {
  candidateServiceDates,
  formatGtfsTime,
  localDateString,
  normalizeGtfsDate,
  parseGtfsTime,
  relativeTimeDe,
  secondsSinceLocalMidnight,
  serviceDateTimeToUtc,
  serviceDateWeekday,
  shiftServiceDate,
  timeZoneOffsetMs,
} from './time.js';

describe('parseGtfsTime / formatGtfsTime', () => {
  it('parst reguläre Zeiten', () => {
    expect(parseGtfsTime('17:38:00')).toBe(17 * 3600 + 38 * 60);
    expect(parseGtfsTime('00:00:00')).toBe(0);
  });

  it('parst Zeiten über 24 Uhr (Nachtverkehr)', () => {
    expect(parseGtfsTime('25:30:00')).toBe(25 * 3600 + 30 * 60);
  });

  it('lehnt ungültige Werte ab', () => {
    expect(parseGtfsTime('abc')).toBeNull();
    expect(parseGtfsTime('17:60:00')).toBeNull();
    expect(parseGtfsTime('')).toBeNull();
  });

  it('formatiert wieder zurück', () => {
    expect(formatGtfsTime(63_480)).toBe('17:38:00');
    expect(formatGtfsTime(91_800)).toBe('25:30:00');
  });
});

describe('normalizeGtfsDate', () => {
  it('wandelt YYYYMMDD in YYYY-MM-DD', () => {
    expect(normalizeGtfsDate('20250311')).toBe('2025-03-11');
    expect(normalizeGtfsDate('2025-03-11')).toBe('2025-03-11');
  });

  it('wirft bei ungültigem Format', () => {
    expect(() => normalizeGtfsDate('11.03.2025')).toThrow();
  });
});

describe('serviceDateTimeToUtc', () => {
  it('rechnet Winterzeit (UTC+1) korrekt um', () => {
    // 11.03.2025 ist MEZ: 17:38 lokal = 16:38 UTC
    const utc = serviceDateTimeToUtc('2025-03-11', 63_480);
    expect(utc.toISOString()).toBe('2025-03-11T16:38:00.000Z');
  });

  it('rechnet Sommerzeit (UTC+2) korrekt um', () => {
    // 15.07.2025 ist MESZ: 17:38 lokal = 15:38 UTC
    const utc = serviceDateTimeToUtc('2025-07-15', 63_480);
    expect(utc.toISOString()).toBe('2025-07-15T15:38:00.000Z');
  });

  it('behandelt Zeiten nach Mitternacht (25:30) als Folgetag', () => {
    const utc = serviceDateTimeToUtc('2025-03-11', 91_800);
    expect(utc.toISOString()).toBe('2025-03-12T00:30:00.000Z');
  });

  it('behandelt den Sommerzeitbeginn (30.03.2025, 02:00 → 03:00)', () => {
    // 01:30 lokal existiert (MEZ, UTC+1) → 00:30 UTC
    expect(serviceDateTimeToUtc('2025-03-30', 5_400).toISOString()).toBe(
      '2025-03-30T00:30:00.000Z',
    );
    // 04:00 lokal ist bereits MESZ (UTC+2) → 02:00 UTC
    expect(serviceDateTimeToUtc('2025-03-30', 14_400).toISOString()).toBe(
      '2025-03-30T02:00:00.000Z',
    );
  });

  it('behandelt das Sommerzeitende (26.10.2025)', () => {
    // 04:00 lokal ist wieder MEZ (UTC+1) → 03:00 UTC
    expect(serviceDateTimeToUtc('2025-10-26', 14_400).toISOString()).toBe(
      '2025-10-26T03:00:00.000Z',
    );
  });
});

describe('timeZoneOffsetMs', () => {
  it('liefert +1 h im Winter und +2 h im Sommer', () => {
    expect(timeZoneOffsetMs(new Date('2025-01-15T12:00:00Z'))).toBe(3_600_000);
    expect(timeZoneOffsetMs(new Date('2025-07-15T12:00:00Z'))).toBe(7_200_000);
  });
});

describe('localDateString / secondsSinceLocalMidnight', () => {
  it('liefert das lokale Datum, nicht das UTC-Datum', () => {
    // 23:30 UTC am 11.03. ist 00:30 lokal am 12.03.
    expect(localDateString(new Date('2025-03-11T23:30:00Z'))).toBe('2025-03-12');
  });

  it('zählt Sekunden seit lokalem Mitternacht', () => {
    expect(secondsSinceLocalMidnight(new Date('2025-03-11T16:38:00Z'))).toBe(63_480);
  });
});

describe('candidateServiceDates', () => {
  it('liefert für 00:30 lokal auch den Vortag mit 24:30', () => {
    const dates = candidateServiceDates(new Date('2025-03-11T23:30:00Z')); // 00:30 lokal am 12.03.
    expect(dates[0]).toEqual({ serviceDate: '2025-03-12', secondsSinceServiceStart: 1_800 });
    expect(dates[1]).toEqual({ serviceDate: '2025-03-11', secondsSinceServiceStart: 88_200 });
  });
});

describe('shiftServiceDate / serviceDateWeekday', () => {
  it('verschiebt über Monatsgrenzen', () => {
    expect(shiftServiceDate('2025-03-01', -1)).toBe('2025-02-28');
    expect(shiftServiceDate('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('liefert Montag = 0', () => {
    expect(serviceDateWeekday('2025-03-10')).toBe(0); // Montag
    expect(serviceDateWeekday('2025-03-16')).toBe(6); // Sonntag
  });
});

describe('relativeTimeDe', () => {
  const now = new Date('2025-03-11T17:42:00Z');
  it('formatiert Minuten', () => {
    expect(relativeTimeDe(new Date('2025-03-11T17:38:00Z'), now)).toBe('vor 4 Minuten');
    expect(relativeTimeDe(new Date('2025-03-11T17:41:00Z'), now)).toBe('vor 1 Minute');
  });
  it('formatiert Sekunden und Stunden', () => {
    expect(relativeTimeDe(new Date('2025-03-11T17:41:50Z'), now)).toBe('gerade eben');
    expect(relativeTimeDe(new Date('2025-03-11T15:42:00Z'), now)).toBe('vor 2 Stunden');
  });
});
