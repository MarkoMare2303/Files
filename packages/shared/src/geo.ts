/**
 * Geodätische Hilfsfunktionen.
 *
 * Bewusst dependency-frei, damit derselbe Code in Node (API/Worker) und in
 * React Native (lokales Vorfiltern, §60) läuft. Für die Distanzen in dieser
 * Anwendung (max. wenige Kilometer) ist die Haversine-Formel auf der Kugel
 * genau genug; präzise Geometrie-Operationen laufen ohnehin in PostGIS.
 */

/** Mittlerer Erdradius in Metern (WGS84 authalic). */
export const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLon {
  lat: number;
  lon: number;
}

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Great-circle-Distanz in Metern. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Anfangspeilung von `a` nach `b` in Grad (0 = Norden, im Uhrzeigersinn). */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Kleinster Winkelabstand zweier Peilungen in Grad, immer 0..180. */
export function bearingDeltaDegrees(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

export interface ProjectionResult {
  /** Nächstgelegener Punkt auf der Linie. */
  point: LatLon;
  /** Abstand des Eingabepunkts zur Linie in Metern. */
  distanceMeters: number;
  /** Index des Segments (Startpunkt), auf dem die Projektion liegt. */
  segmentIndex: number;
  /** Zurückgelegte Distanz entlang der Linie bis zum Projektionspunkt, in Metern. */
  distanceAlongMeters: number;
  /** Anteil 0..1 entlang der Gesamtlinie. */
  fraction: number;
  /** Richtung des Segments an der Projektionsstelle. */
  segmentBearing: number;
}

/**
 * Projiziert einen Punkt auf einen Polygonzug (GTFS-Shape).
 *
 * Verwendet lokal eine äquidistante Zylinderprojektion um den Referenzbreitengrad;
 * der Fehler liegt bei Segmentlängen < 10 km deutlich unter einem Meter und ist
 * für die Distanzbewertung irrelevant.
 */
export function projectOnPolyline(point: LatLon, line: readonly LatLon[]): ProjectionResult | null {
  if (line.length === 0) return null;
  const first = line[0]!;
  if (line.length === 1) {
    return {
      point: first,
      distanceMeters: haversineMeters(point, first),
      segmentIndex: 0,
      distanceAlongMeters: 0,
      fraction: 0,
      segmentBearing: 0,
    };
  }

  const latRef = toRadians(point.lat);
  const mx = Math.cos(latRef) * EARTH_RADIUS_M;
  const my = EARTH_RADIUS_M;
  const px = toRadians(point.lon) * mx;
  const py = toRadians(point.lat) * my;

  let best: ProjectionResult | null = null;
  let cumulative = 0;
  const cumulativeAt: number[] = [0];

  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const ax = toRadians(a.lon) * mx;
    const ay = toRadians(a.lat) * my;
    const bx = toRadians(b.lon) * mx;
    const by = toRadians(b.lat) * my;

    const dx = bx - ax;
    const dy = by - ay;
    const segLenSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(segLenSq);

    let t = 0;
    if (segLenSq > 0) {
      t = clamp(((px - ax) * dx + (py - ay) * dy) / segLenSq, 0, 1);
    }
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const distance = Math.hypot(px - cx, py - cy);

    if (!best || distance < best.distanceMeters) {
      best = {
        point: { lat: toDegrees(cy / my), lon: toDegrees(cx / mx) },
        distanceMeters: distance,
        segmentIndex: i,
        distanceAlongMeters: cumulative + t * segLen,
        fraction: 0,
        segmentBearing: bearingDegrees(a, b),
      };
    }
    cumulative += segLen;
    cumulativeAt.push(cumulative);
  }

  if (!best) return null;
  best.fraction = cumulative > 0 ? clamp(best.distanceAlongMeters / cumulative, 0, 1) : 0;
  return best;
}

/** Gesamtlänge eines Polygonzugs in Metern. */
export function polylineLengthMeters(line: readonly LatLon[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    total += haversineMeters(line[i]!, line[i + 1]!);
  }
  return total;
}

/** Punkt in gegebener Distanz entlang eines Polygonzugs (lineare Interpolation). */
export function pointAlongPolyline(line: readonly LatLon[], distanceMeters: number): LatLon | null {
  if (line.length === 0) return null;
  if (line.length === 1 || distanceMeters <= 0) return line[0]!;
  let remaining = distanceMeters;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const segLen = haversineMeters(a, b);
    if (segLen === 0) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
    remaining -= segLen;
  }
  return line[line.length - 1]!;
}

/** Geschwindigkeit in m/s zwischen zwei Beobachtungen. */
export function speedBetween(
  a: LatLon & { timestamp: Date },
  b: LatLon & { timestamp: Date },
): number | null {
  const dtSeconds = Math.abs(b.timestamp.getTime() - a.timestamp.getTime()) / 1000;
  if (dtSeconds < 0.5) return null;
  return haversineMeters(a, b) / dtSeconds;
}

export const MPS_TO_KMH = 3.6;
export const KMH_TO_MPS = 1 / 3.6;

/**
 * Rundet Koordinaten auf ein Gitter. Wird für gespeicherte Meldungspositionen
 * verwendet: ~3 Nachkommastellen ≈ 110 m — genug für die Karte, zu grob für ein
 * Bewegungsprofil (§15/§23).
 */
export function roundCoordinate(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function isInsideBoundingBox(point: LatLon, box: BoundingBox): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lon >= box.minLon &&
    point.lon <= box.maxLon
  );
}

/** Bounding Box um einen Punkt mit gegebenem Radius (für Vorfilter-Queries). */
export function boundingBoxAround(point: LatLon, radiusMeters: number): BoundingBox {
  const latDelta = toDegrees(radiusMeters / EARTH_RADIUS_M);
  const cosLat = Math.max(0.01, Math.cos(toRadians(point.lat)));
  const lonDelta = toDegrees(radiusMeters / (EARTH_RADIUS_M * cosLat));
  return {
    minLat: point.lat - latDelta,
    maxLat: point.lat + latDelta,
    minLon: point.lon - lonDelta,
    maxLon: point.lon + lonDelta,
  };
}
