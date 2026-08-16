import { VehicleType } from '@swissov/types';
import { bearingDegrees, haversineMeters, polylineLengthMeters, projectOnPolyline } from '../geo.js';
import { serviceDateTimeToUtc } from '../time.js';
import type { Candidate, CandidateStop, Observation, ShapeProjection } from './types.js';

/**
 * TESTDATEN — NICHT FÜR DEN PRODUKTIVBETRIEB (§49/§56).
 *
 * Diese Datei enthält ausschliesslich Fixtures für Unit-Tests und lokale
 * Entwicklung. Sie wird von keinem Produktionspfad importiert; die API baut
 * Kandidaten ausnahmslos aus importierten GTFS-Daten.
 *
 * Koordinaten sind real (Bahnhofsstandorte), die Fahrplanzeiten sind
 * vereinfachte, plausible Werte — kein Abbild eines echten Fahrplans.
 */

export const FIXTURE_STOPS = {
  zurichHb: { stopId: '8503000', name: 'Zürich HB', lat: 47.3779, lon: 8.5403 },
  zurichAltstetten: { stopId: '8503001', name: 'Zürich Altstetten', lat: 47.3915, lon: 8.4881 },
  lenzburg: { stopId: '8502113', name: 'Lenzburg', lat: 47.3918, lon: 8.1685 },
  aarau: { stopId: '8502113_A', name: 'Aarau', lat: 47.3914, lon: 8.0512 },
  olten: { stopId: '8500218', name: 'Olten', lat: 47.3519, lon: 7.9077 },
  liestal: { stopId: '8500020', name: 'Liestal', lat: 47.4842, lon: 7.7315 },
  baselSbb: { stopId: '8500010', name: 'Basel SBB', lat: 47.5474, lon: 7.5896 },
  bern: { stopId: '8507000', name: 'Bern', lat: 46.949, lon: 7.4396 },
  burgdorf: { stopId: '8500207', name: 'Burgdorf', lat: 47.0596, lon: 7.6199 },
  zurichCentral: { stopId: '8591317', name: 'Zürich, Central', lat: 47.3766, lon: 8.544 },
  zurichBahnhofquai: { stopId: '8591123', name: 'Zürich, Bahnhofquai/HB', lat: 47.3771, lon: 8.5411 },
  zurichStampfenbach: { stopId: '8591374', name: 'Zürich, Stampfenbachplatz', lat: 47.3812, lon: 8.5424 },
  baselBarfuesserplatz: { stopId: '8589008', name: 'Basel, Barfüsserplatz', lat: 47.5548, lon: 7.5885 },
  baselAeschenplatz: { stopId: '8589003', name: 'Basel, Aeschenplatz', lat: 47.5502, lon: 7.5934 },
  chur: { stopId: '8509000', name: 'Chur', lat: 46.8531, lon: 9.5289 },
  thusis: { stopId: '8509197', name: 'Thusis', lat: 46.6975, lon: 9.4405 },
} as const;

/**
 * Bewusst strukturell und nicht als Union der Werte von `FIXTURE_STOPS`:
 * Erweiterte Szenarien (`scenarios.ts`) bringen eigene Haltestellen mit, die
 * sonst nicht zuweisbar wären.
 */
export interface FixtureStop {
  readonly stopId: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

/** Erzeugt eine Linie mit Zwischenpunkten zwischen den Halten. */
export function buildShape(stops: readonly FixtureStop[], pointsPerSegment = 6) {
  const line: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    for (let s = 0; s < pointsPerSegment; s += 1) {
      const t = s / pointsPerSegment;
      line.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  const last = stops[stops.length - 1]!;
  line.push({ lat: last.lat, lon: last.lon });
  return line;
}

export interface FixtureTripSpec {
  tripId: string;
  serviceDate: string;
  routeId: string;
  routeShortName: string;
  routeLongName?: string;
  agencyId: string;
  agencyName: string;
  vehicleType: VehicleType;
  directionId: number;
  stops: readonly FixtureStop[];
  /** Abfahrtszeiten je Halt in Sekunden seit Betriebstagsbeginn. */
  departureSeconds: readonly number[];
}

/** Baut einen vollständigen Kandidaten inkl. Projektion für eine Beobachtung. */
export function buildCandidate(spec: FixtureTripSpec, observation: Observation, options?: {
  previousObservation?: Observation;
  realtimeDelaySeconds?: number | null;
  cancelled?: boolean;
  realtimeUpdatedAt?: Date | null;
}): Candidate {
  const shape = buildShape(spec.stops);
  const shapeLength = polylineLengthMeters(shape);

  const stops: CandidateStop[] = spec.stops.map((stop, index) => {
    const seconds = spec.departureSeconds[index]!;
    const at = serviceDateTimeToUtc(spec.serviceDate, seconds);
    return {
      stopId: stop.stopId,
      stopName: stop.name,
      stopSequence: index + 1,
      lat: stop.lat,
      lon: stop.lon,
      scheduledArrival: at,
      scheduledDeparture: at,
    };
  });

  const scheduledStart = stops[0]!.scheduledDeparture!;
  const scheduledEnd = stops[stops.length - 1]!.scheduledArrival!;

  // Letzter passierter / nächster Halt gemäss Fahrplan.
  const now = observation.timestamp.getTime();
  let previousStop: CandidateStop | null = null;
  let nextStop: CandidateStop | null = null;
  for (const stop of stops) {
    const at = stop.scheduledDeparture!.getTime();
    if (at <= now) previousStop = stop;
    else if (!nextStop) nextStop = stop;
  }

  // Planposition: lineare Interpolation zwischen den beiden Halten.
  let expectedPosition: { lat: number; lon: number } | null = null;
  if (previousStop && nextStop) {
    const span = nextStop.scheduledArrival!.getTime() - previousStop.scheduledDeparture!.getTime();
    const t = span > 0 ? (now - previousStop.scheduledDeparture!.getTime()) / span : 0;
    expectedPosition = {
      lat: previousStop.lat + (nextStop.lat - previousStop.lat) * t,
      lon: previousStop.lon + (nextStop.lon - previousStop.lon) * t,
    };
  } else if (previousStop) {
    expectedPosition = { lat: previousStop.lat, lon: previousStop.lon };
  } else if (stops[0]) {
    expectedPosition = { lat: stops[0].lat, lon: stops[0].lon };
  }

  const projection = toProjection(observation, shape, shapeLength);
  const previousProjection = options?.previousObservation
    ? toProjection(options.previousObservation, shape, shapeLength)
    : null;

  return {
    tripId: spec.tripId,
    serviceDate: spec.serviceDate,
    routeId: spec.routeId,
    routeShortName: spec.routeShortName,
    routeLongName: spec.routeLongName ?? null,
    routeColor: null,
    agencyId: spec.agencyId,
    agencyName: spec.agencyName,
    vehicleType: spec.vehicleType,
    headsign: spec.stops[spec.stops.length - 1]!.name,
    directionId: spec.directionId,
    origin: spec.stops[0]!.name,
    destination: spec.stops[spec.stops.length - 1]!.name,
    scheduledStart,
    scheduledEnd,
    projection,
    previousProjection,
    previousStop,
    nextStop,
    expectedPosition,
    realtime:
      options?.realtimeDelaySeconds !== undefined || options?.cancelled
        ? {
            delaySeconds: options.realtimeDelaySeconds ?? null,
            cancelled: options.cancelled ?? false,
            updatedAt: options.realtimeUpdatedAt ?? observation.timestamp,
          }
        : null,
    stopCount: stops.length,
  };
}

function toProjection(
  observation: Observation,
  shape: Array<{ lat: number; lon: number }>,
  shapeLength: number,
): ShapeProjection | null {
  const projected = projectOnPolyline(observation, shape);
  if (!projected) return null;
  return {
    distanceMeters: projected.distanceMeters,
    fraction: projected.fraction,
    bearingDegrees: projected.segmentBearing,
    shapeLengthMeters: shapeLength,
  };
}

/** IC 3 Zürich HB → Basel SBB, Abfahrt 17:32. */
export const IC3_ZURICH_BASEL: FixtureTripSpec = {
  tripId: 'fixture.ic3.zh-bs',
  serviceDate: '2025-03-11',
  routeId: 'fixture-route-ic3',
  routeShortName: 'IC 3',
  routeLongName: 'Zürich HB – Basel SBB',
  agencyId: '11',
  agencyName: 'Schweizerische Bundesbahnen SBB',
  vehicleType: VehicleType.RAIL,
  directionId: 0,
  stops: [
    FIXTURE_STOPS.zurichHb,
    FIXTURE_STOPS.zurichAltstetten,
    FIXTURE_STOPS.lenzburg,
    FIXTURE_STOPS.aarau,
    FIXTURE_STOPS.olten,
    FIXTURE_STOPS.liestal,
    FIXTURE_STOPS.baselSbb,
  ],
  //        17:32   17:40   17:52   18:00   18:10   18:24   18:35
  departureSeconds: [63_120, 63_600, 64_320, 64_800, 65_400, 66_240, 66_900],
};

/** Gegenrichtung — dient zum Nachweis, dass die Richtungsbewertung greift. */
export const IC3_BASEL_ZURICH: FixtureTripSpec = {
  tripId: 'fixture.ic3.bs-zh',
  serviceDate: '2025-03-11',
  routeId: 'fixture-route-ic3',
  routeShortName: 'IC 3',
  routeLongName: 'Basel SBB – Zürich HB',
  agencyId: '11',
  agencyName: 'Schweizerische Bundesbahnen SBB',
  vehicleType: VehicleType.RAIL,
  directionId: 1,
  stops: [
    FIXTURE_STOPS.baselSbb,
    FIXTURE_STOPS.liestal,
    FIXTURE_STOPS.olten,
    FIXTURE_STOPS.aarau,
    FIXTURE_STOPS.lenzburg,
    FIXTURE_STOPS.zurichAltstetten,
    FIXTURE_STOPS.zurichHb,
  ],
  departureSeconds: [63_120, 63_780, 64_620, 65_220, 65_700, 66_540, 66_900],
};

/** Tram 10 innerhalb Zürich — dieselbe Gegend, aber ganz anderes Geschwindigkeitsprofil. */
export const TRAM_ZURICH: FixtureTripSpec = {
  tripId: 'fixture.tram10.zh',
  serviceDate: '2025-03-11',
  routeId: 'fixture-route-tram10',
  routeShortName: '10',
  agencyId: '3849',
  agencyName: 'Verkehrsbetriebe Zürich',
  vehicleType: VehicleType.TRAM,
  directionId: 0,
  stops: [
    FIXTURE_STOPS.zurichBahnhofquai,
    FIXTURE_STOPS.zurichCentral,
    FIXTURE_STOPS.zurichStampfenbach,
  ],
  //        17:36   17:38   17:40
  departureSeconds: [63_360, 63_480, 63_600],
};

/** Bus innerhalb Basel. */
export const BUS_BASEL: FixtureTripSpec = {
  tripId: 'fixture.bus50.bs',
  serviceDate: '2025-03-11',
  routeId: 'fixture-route-bus50',
  routeShortName: '50',
  agencyId: '3853',
  agencyName: 'Basler Verkehrs-Betriebe',
  vehicleType: VehicleType.BUS,
  directionId: 0,
  stops: [
    FIXTURE_STOPS.baselSbb,
    FIXTURE_STOPS.baselAeschenplatz,
    FIXTURE_STOPS.baselBarfuesserplatz,
  ],
  departureSeconds: [63_300, 63_540, 63_780],
};

/** PostAuto im ländlichen Raum (Domleschg/GR). */
export const POSTAUTO_RURAL: FixtureTripSpec = {
  tripId: 'fixture.postauto.gr',
  serviceDate: '2025-03-11',
  routeId: 'fixture-route-pa',
  routeShortName: '541',
  agencyId: '801',
  agencyName: 'PostAuto Schweiz',
  vehicleType: VehicleType.BUS,
  directionId: 0,
  stops: [FIXTURE_STOPS.chur, FIXTURE_STOPS.thusis],
  departureSeconds: [63_000, 65_100],
};

/** IC 1 Bern → Zürich HB. */
export const IC1_BERN_ZURICH: FixtureTripSpec = {
  tripId: 'fixture.ic1.be-zh',
  serviceDate: '2025-03-11',
  routeId: 'fixture-route-ic1',
  routeShortName: 'IC 1',
  agencyId: '11',
  agencyName: 'Schweizerische Bundesbahnen SBB',
  vehicleType: VehicleType.RAIL,
  directionId: 0,
  stops: [FIXTURE_STOPS.bern, FIXTURE_STOPS.burgdorf, FIXTURE_STOPS.olten, FIXTURE_STOPS.zurichHb],
  departureSeconds: [63_000, 63_720, 64_800, 66_600],
};

/** Beobachtung auf der Linie zwischen zwei Halten erzeugen (für Tests). */
export function observationBetween(
  from: FixtureStop,
  to: FixtureStop,
  fraction: number,
  timestamp: Date,
  overrides: Partial<Observation> = {},
): Observation {
  const lat = from.lat + (to.lat - from.lat) * fraction;
  const lon = from.lon + (to.lon - from.lon) * fraction;
  const distance = haversineMeters(from, to);
  return {
    lat,
    lon,
    accuracyMeters: 12,
    headingDegrees: bearingDegrees(from, to),
    speedMps: distance / 360,
    timestamp,
    ...overrides,
  };
}
