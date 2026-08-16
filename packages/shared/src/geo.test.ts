import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  bearingDeltaDegrees,
  boundingBoxAround,
  haversineMeters,
  isInsideBoundingBox,
  pointAlongPolyline,
  polylineLengthMeters,
  projectOnPolyline,
  roundCoordinate,
  speedBetween,
} from './geo.js';

const ZURICH_HB = { lat: 47.3779, lon: 8.5403 };
const ZURICH_ALTSTETTEN = { lat: 47.3915, lon: 8.4881 };
const BASEL_SBB = { lat: 47.5474, lon: 7.5896 };

describe('haversineMeters', () => {
  it('berechnet die Distanz Zürich HB → Zürich Altstetten (~4,1 km)', () => {
    const distance = haversineMeters(ZURICH_HB, ZURICH_ALTSTETTEN);
    expect(distance).toBeGreaterThan(3900);
    expect(distance).toBeLessThan(4300);
  });

  it('berechnet die Luftlinie Zürich HB → Basel SBB (~74 km)', () => {
    const distance = haversineMeters(ZURICH_HB, BASEL_SBB);
    expect(distance / 1000).toBeGreaterThan(72);
    expect(distance / 1000).toBeLessThan(76);
  });

  it('ist symmetrisch und für identische Punkte null', () => {
    expect(haversineMeters(ZURICH_HB, ZURICH_HB)).toBe(0);
    expect(haversineMeters(ZURICH_HB, BASEL_SBB)).toBeCloseTo(
      haversineMeters(BASEL_SBB, ZURICH_HB),
      6,
    );
  });
});

describe('bearingDegrees', () => {
  it('zeigt von Zürich HB nach Altstetten nach Westnordwesten', () => {
    const bearing = bearingDegrees(ZURICH_HB, ZURICH_ALTSTETTEN);
    expect(bearing).toBeGreaterThan(280);
    expect(bearing).toBeLessThan(310);
  });

  it('liefert 0° für exakt nördliche Richtung', () => {
    expect(bearingDegrees({ lat: 47, lon: 8 }, { lat: 48, lon: 8 })).toBeCloseTo(0, 5);
  });
});

describe('bearingDeltaDegrees', () => {
  it('behandelt den Überlauf bei 360°', () => {
    expect(bearingDeltaDegrees(350, 10)).toBe(20);
    expect(bearingDeltaDegrees(10, 350)).toBe(20);
  });

  it('liefert maximal 180°', () => {
    expect(bearingDeltaDegrees(0, 180)).toBe(180);
    expect(bearingDeltaDegrees(0, 270)).toBe(90);
  });
});

describe('projectOnPolyline', () => {
  const line = [ZURICH_HB, ZURICH_ALTSTETTEN, BASEL_SBB];

  it('findet einen Punkt direkt auf der Linie mit Abstand ~0', () => {
    const midpoint = {
      lat: (ZURICH_HB.lat + ZURICH_ALTSTETTEN.lat) / 2,
      lon: (ZURICH_HB.lon + ZURICH_ALTSTETTEN.lon) / 2,
    };
    const result = projectOnPolyline(midpoint, line);
    expect(result).not.toBeNull();
    expect(result!.distanceMeters).toBeLessThan(2);
    expect(result!.segmentIndex).toBe(0);
    expect(result!.fraction).toBeGreaterThan(0);
    expect(result!.fraction).toBeLessThan(0.1);
  });

  it('misst den senkrechten Abstand eines abseits liegenden Punkts', () => {
    // ~0.009° Breite ≈ 1000 m nördlich der Verbindung
    const off = { lat: ZURICH_HB.lat + 0.009, lon: ZURICH_HB.lon };
    const result = projectOnPolyline(off, line);
    expect(result!.distanceMeters).toBeGreaterThan(500);
    expect(result!.distanceMeters).toBeLessThan(1200);
  });

  it('gibt für eine leere Linie null zurück', () => {
    expect(projectOnPolyline(ZURICH_HB, [])).toBeNull();
  });

  it('liefert für einen Einzelpunkt die Distanz zu diesem Punkt', () => {
    const result = projectOnPolyline(ZURICH_ALTSTETTEN, [ZURICH_HB]);
    expect(result!.distanceMeters).toBeCloseTo(haversineMeters(ZURICH_ALTSTETTEN, ZURICH_HB), 0);
  });

  it('wächst monoton in der Distanz entlang der Linie', () => {
    const a = projectOnPolyline(ZURICH_HB, line)!;
    const b = projectOnPolyline(ZURICH_ALTSTETTEN, line)!;
    const c = projectOnPolyline(BASEL_SBB, line)!;
    expect(a.distanceAlongMeters).toBeLessThan(b.distanceAlongMeters);
    expect(b.distanceAlongMeters).toBeLessThan(c.distanceAlongMeters);
    expect(c.fraction).toBeCloseTo(1, 2);
  });
});

describe('polylineLengthMeters / pointAlongPolyline', () => {
  it('summiert die Segmentlängen', () => {
    const length = polylineLengthMeters([ZURICH_HB, ZURICH_ALTSTETTEN, BASEL_SBB]);
    const expected =
      haversineMeters(ZURICH_HB, ZURICH_ALTSTETTEN) + haversineMeters(ZURICH_ALTSTETTEN, BASEL_SBB);
    expect(length).toBeCloseTo(expected, 3);
  });

  it('interpoliert einen Punkt in der Mitte des ersten Segments', () => {
    const half = haversineMeters(ZURICH_HB, ZURICH_ALTSTETTEN) / 2;
    const point = pointAlongPolyline([ZURICH_HB, ZURICH_ALTSTETTEN], half)!;
    expect(haversineMeters(point, ZURICH_HB)).toBeCloseTo(half, -1);
  });

  it('gibt bei Überlänge den Endpunkt zurück', () => {
    const point = pointAlongPolyline([ZURICH_HB, ZURICH_ALTSTETTEN], 1_000_000)!;
    expect(point.lat).toBeCloseTo(ZURICH_ALTSTETTEN.lat, 6);
  });
});

describe('speedBetween', () => {
  it('berechnet die Geschwindigkeit zwischen zwei Beobachtungen', () => {
    const t0 = new Date('2025-03-11T17:38:00Z');
    const t1 = new Date('2025-03-11T17:41:00Z'); // 180 s
    const speed = speedBetween(
      { ...ZURICH_HB, timestamp: t0 },
      { ...ZURICH_ALTSTETTEN, timestamp: t1 },
    );
    expect(speed).not.toBeNull();
    // ~4,1 km in 3 Minuten ≈ 22,8 m/s ≈ 82 km/h
    expect(speed! * 3.6).toBeGreaterThan(75);
    expect(speed! * 3.6).toBeLessThan(90);
  });

  it('gibt bei zu kleinem Zeitabstand null zurück', () => {
    const t = new Date('2025-03-11T17:38:00Z');
    expect(
      speedBetween({ ...ZURICH_HB, timestamp: t }, { ...ZURICH_ALTSTETTEN, timestamp: t }),
    ).toBeNull();
  });
});

describe('roundCoordinate', () => {
  it('rundet auf ~110 m Gitter (3 Nachkommastellen)', () => {
    expect(roundCoordinate(47.377925)).toBe(47.378);
    expect(roundCoordinate(8.540192)).toBe(8.54);
  });
});

describe('boundingBoxAround / isInsideBoundingBox', () => {
  it('enthält den Mittelpunkt und schliesst weit entfernte Punkte aus', () => {
    const box = boundingBoxAround(ZURICH_HB, 1000);
    expect(isInsideBoundingBox(ZURICH_HB, box)).toBe(true);
    expect(isInsideBoundingBox(BASEL_SBB, box)).toBe(false);
  });

  it('deckt den angegebenen Radius ab', () => {
    const box = boundingBoxAround(ZURICH_HB, 5000);
    expect(isInsideBoundingBox(ZURICH_ALTSTETTEN, box)).toBe(true);
  });
});
