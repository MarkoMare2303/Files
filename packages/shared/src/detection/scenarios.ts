import { VehicleType } from '@swissov/types';
import { bearingDegrees, haversineMeters } from '../geo.js';
import { serviceDateTimeToUtc } from '../time.js';
import { FIXTURE_STOPS, type FixtureStop, type FixtureTripSpec } from './fixtures.js';
import type { Observation } from './types.js';

/**
 * TESTDATEN — NICHT FÜR DEN PRODUKTIVBETRIEB (§49/§56).
 *
 * Erweiterte Szenarien für die Härtung der Fahrtenerkennung: alle
 * Landesteile, alle Verkehrsmittel und — besonders wichtig — die Fälle, in
 * denen die Erkennung NICHT anschlagen darf.
 *
 * Die Haltestellen-Koordinaten sind real. Die Fahrplanzeiten sind
 * vereinfachte, plausible Werte und bilden keinen echten Fahrplan ab.
 *
 * Alle Fahrten liegen bewusst auf demselben Betriebstag (2025-03-11, ein
 * Dienstag) wie die Basis-Fixtures — dadurch lassen sich Fahrten
 * unterschiedlicher Linien im selben Zeitfenster gegeneinander stellen, was
 * die eigentliche Schwierigkeit der Erkennung ist.
 */
export const SERVICE_DATE = '2025-03-11';

export const EXTRA_STOPS = {
  // Zürich und Umgebung
  zurichStadelhofen: { stopId: '8503003', name: 'Zürich Stadelhofen', lat: 47.3666, lon: 8.5482 },
  zurichOerlikon: { stopId: '8503006', name: 'Zürich Oerlikon', lat: 47.4118, lon: 8.5442 },
  stettbach: { stopId: '8503004', name: 'Stettbach', lat: 47.3987, lon: 8.5964 },
  dubendorf: { stopId: '8503301', name: 'Dübendorf', lat: 47.3968, lon: 8.6187 },
  uster: { stopId: '8503305', name: 'Uster', lat: 47.3517, lon: 8.7183 },
  wetzikon: { stopId: '8503307', name: 'Wetzikon ZH', lat: 47.3266, lon: 8.7973 },
  winterthur: { stopId: '8506000', name: 'Winterthur', lat: 47.5003, lon: 8.7238 },
  zurichPolyterrasse: { stopId: '8591382', name: 'Zürich, Polyterrasse', lat: 47.3765, lon: 8.5478 },

  // Romandie
  lausanne: { stopId: '8501120', name: 'Lausanne', lat: 46.5169, lon: 6.6291 },
  lausanneFlon: { stopId: '8592050', name: 'Lausanne-Flon', lat: 46.5197, lon: 6.6296 },
  lausanneOuchy: { stopId: '8592055', name: 'Ouchy-Olympique', lat: 46.5072, lon: 6.6274 },
  lausanneSallaz: { stopId: '8592060', name: 'Sallaz', lat: 46.5296, lon: 6.6449 },
  geneve: { stopId: '8501008', name: 'Genève', lat: 46.2102, lon: 6.1424 },
  geneveCornavin: { stopId: '8587057', name: 'Genève, Cornavin', lat: 46.2103, lon: 6.1425 },
  geneveBelAir: { stopId: '8587062', name: 'Genève, Bel-Air', lat: 46.2049, lon: 6.1432 },
  genevePlainpalais: { stopId: '8587070', name: 'Genève, Plainpalais', lat: 46.1976, lon: 6.1409 },
  nyon: { stopId: '8501100', name: 'Nyon', lat: 46.3839, lon: 6.2384 },
  morges: { stopId: '8501111', name: 'Morges', lat: 46.5115, lon: 6.4986 },
  fribourg: { stopId: '8504100', name: 'Fribourg/Freiburg', lat: 46.8032, lon: 7.1512 },

  // Ticino
  lugano: { stopId: '8505300', name: 'Lugano', lat: 46.0053, lon: 8.9471 },
  bellinzona: { stopId: '8505000', name: 'Bellinzona', lat: 46.1954, lon: 9.0301 },
  locarno: { stopId: '8505400', name: 'Locarno', lat: 46.1723, lon: 8.7936 },
  giubiasco: { stopId: '8505001', name: 'Giubiasco', lat: 46.1746, lon: 9.0086 },

  // Zentralschweiz und Gotthard
  luzern: { stopId: '8505000_LU', name: 'Luzern', lat: 47.0502, lon: 8.3103 },
  luzernBahnhofplatz: { stopId: '8589200', name: 'Luzern, Bahnhofplatz', lat: 47.0498, lon: 8.3106 },
  luzernKantonalbank: { stopId: '8589210', name: 'Luzern, Kantonalbank', lat: 47.0526, lon: 8.3079 },
  erstfeld: { stopId: '8502001', name: 'Erstfeld', lat: 46.8195, lon: 8.6499 },
  bodio: { stopId: '8505200', name: 'Bodio', lat: 46.3808, lon: 8.9114 },
  goschenen: { stopId: '8502003', name: 'Göschenen', lat: 46.6674, lon: 8.5866 },
  andermatt: { stopId: '8502004', name: 'Andermatt', lat: 46.6357, lon: 8.5942 },
  weggis: { stopId: '8505600', name: 'Weggis', lat: 47.0339, lon: 8.4324 },
  rigiKaltbad: { stopId: '8505610', name: 'Rigi Kaltbad', lat: 47.0475, lon: 8.4664 },

  // Ostschweiz
  stGallen: { stopId: '8506302', name: 'St. Gallen', lat: 47.4232, lon: 9.3697 },
  gossau: { stopId: '8506314', name: 'Gossau SG', lat: 47.4166, lon: 9.2528 },
  wil: { stopId: '8506313', name: 'Wil SG', lat: 47.4635, lon: 9.0428 },
  sargans: { stopId: '8509411', name: 'Sargans', lat: 47.0459, lon: 9.4437 },
  landquart: { stopId: '8509402', name: 'Landquart', lat: 46.9689, lon: 9.5551 },

  // Wallis
  visp: { stopId: '8501609', name: 'Visp', lat: 46.2937, lon: 7.8817 },
  zermatt: { stopId: '8501689', name: 'Zermatt', lat: 46.0237, lon: 7.7482 },
  brig: { stopId: '8501609_B', name: 'Brig', lat: 46.3195, lon: 7.9881 },
  sion: { stopId: '8501600', name: 'Sion', lat: 46.2274, lon: 7.3268 },

  // Seen
  zurichBurkliplatz: { stopId: '8503091', name: 'Zürich Bürkliplatz (See)', lat: 47.3663, lon: 8.5411 },
  thalwil: { stopId: '8503009', name: 'Thalwil (See)', lat: 47.2929, lon: 8.5651 },
} as const;

const rail = (
  tripId: string,
  routeShortName: string,
  stops: readonly FixtureStop[],
  departureSeconds: readonly number[],
  overrides: Partial<FixtureTripSpec> = {},
): FixtureTripSpec => ({
  tripId,
  serviceDate: SERVICE_DATE,
  routeId: `fixture-route-${routeShortName.replace(/\s+/g, '').toLowerCase()}`,
  routeShortName,
  agencyId: '11',
  agencyName: 'Schweizerische Bundesbahnen SBB',
  vehicleType: VehicleType.RAIL,
  directionId: 0,
  stops,
  departureSeconds,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Schiene
// ---------------------------------------------------------------------------

/** S 3 Zürich HB → Wetzikon, 07:12 (Pendlerverkehr). */
export const S3_ZURICH_WETZIKON = rail(
  'fixture.s3.zh-wetzikon',
  'S 3',
  [
    FIXTURE_STOPS.zurichHb,
    EXTRA_STOPS.zurichStadelhofen,
    EXTRA_STOPS.stettbach,
    EXTRA_STOPS.dubendorf,
    EXTRA_STOPS.uster,
    EXTRA_STOPS.wetzikon,
  ],
  //  07:12   07:15   07:20   07:23   07:31   07:40
  [25_920, 26_100, 26_400, 26_580, 27_060, 27_600],
);

/**
 * S 9 auf demselben Streckenabschnitt Zürich HB → Stettbach, vier Minuten
 * später. Die schwierigste reale Situation: gleiche Gleise, gleiche Richtung,
 * nur zeitversetzt.
 */
export const S9_ZURICH_USTER = rail(
  'fixture.s9.zh-uster',
  'S 9',
  [
    FIXTURE_STOPS.zurichHb,
    EXTRA_STOPS.zurichStadelhofen,
    EXTRA_STOPS.stettbach,
    EXTRA_STOPS.uster,
  ],
  //  07:16   07:19   07:24   07:34
  [26_160, 26_340, 26_640, 27_240],
);

/** IC 5 Genève → Lausanne → Fribourg, 09:02. */
export const IC5_GENEVE_FRIBOURG = rail(
  'fixture.ic5.ge-fr',
  'IC 5',
  [EXTRA_STOPS.geneve, EXTRA_STOPS.nyon, EXTRA_STOPS.morges, EXTRA_STOPS.lausanne, EXTRA_STOPS.fribourg],
  //  09:02   09:16   09:29   09:38   10:15
  [32_520, 33_360, 34_140, 34_680, 36_900],
);

/** IR 26 Zürich HB → Chur über Sargans, 14:07. */
export const IR26_ZURICH_CHUR = rail(
  'fixture.ir26.zh-ch',
  'IR 26',
  [FIXTURE_STOPS.zurichHb, EXTRA_STOPS.sargans, EXTRA_STOPS.landquart, FIXTURE_STOPS.chur],
  //  14:07   15:02   15:14   15:22
  [50_820, 54_120, 54_840, 55_320],
);

/** IC 2 Lugano → Bellinzona, 11:24 (Ticino). */
export const IC2_LUGANO_BELLINZONA = rail(
  'fixture.ic2.lu-be',
  'IC 2',
  [EXTRA_STOPS.lugano, EXTRA_STOPS.giubiasco, EXTRA_STOPS.bellinzona],
  //  11:24   11:47   11:51
  [41_040, 42_420, 42_660],
);

/**
 * Regionalzug auf derselben Achse Lugano → Bellinzona, nur langsamer und
 * zwölf Minuten früher gestartet. Prüft, ob Zeitfenster und Fahrplantreue
 * die beiden auseinanderhalten.
 */
export const S10_LUGANO_BELLINZONA = rail(
  'fixture.s10.lu-be',
  'S 10',
  [EXTRA_STOPS.lugano, EXTRA_STOPS.giubiasco, EXTRA_STOPS.bellinzona],
  //  11:12   11:44   11:50
  [40_320, 42_240, 42_600],
);

/** S 1 St. Gallen → Wil, 16:38 (Ostschweiz). */
export const S1_STGALLEN_WIL = rail(
  'fixture.s1.sg-wil',
  'S 1',
  [EXTRA_STOPS.stGallen, EXTRA_STOPS.gossau, EXTRA_STOPS.wil],
  //  16:38   16:47   17:01
  [59_880, 60_420, 61_260],
);

/** IR 90 Brig → Sion → Lausanne, 13:05 (Wallis). */
export const IR90_BRIG_LAUSANNE = rail(
  'fixture.ir90.br-la',
  'IR 90',
  [EXTRA_STOPS.brig, EXTRA_STOPS.visp, EXTRA_STOPS.sion, EXTRA_STOPS.lausanne],
  //  13:05   13:13   13:38   14:34
  [47_100, 47_580, 49_080, 52_440],
);

/**
 * Gotthard-Basistunnel Erstfeld → Bodio, 10:40.
 * 57 km ohne GPS-Empfang — der wichtigste Sonderfall der Schweiz.
 */
export const GOTTHARD_BASE_TUNNEL = rail(
  'fixture.gotthard.tunnel',
  'IC 21',
  [EXTRA_STOPS.erstfeld, EXTRA_STOPS.bodio],
  //  10:40   11:00
  [38_400, 39_600],
);

/** Rhätische Bahn Chur → Thusis, 09:58 — dieselbe Achse wie das PostAuto. */
export const RHB_CHUR_THUSIS = rail(
  'fixture.rhb.ch-th',
  'RE 1',
  [FIXTURE_STOPS.chur, FIXTURE_STOPS.thusis],
  //  09:58   10:24
  [35_880, 37_440],
  { agencyId: '33', agencyName: 'Rhätische Bahn' },
);

// ---------------------------------------------------------------------------
// Stadtverkehr
// ---------------------------------------------------------------------------

/** Metro m2 Lausanne (Untergrundbahn, sehr steil). */
export const M2_LAUSANNE: FixtureTripSpec = {
  tripId: 'fixture.m2.lausanne',
  serviceDate: SERVICE_DATE,
  routeId: 'fixture-route-m2',
  routeShortName: 'm2',
  agencyId: '3860',
  agencyName: 'Transports publics de la région lausannoise',
  vehicleType: VehicleType.SUBWAY,
  directionId: 0,
  stops: [EXTRA_STOPS.lausanneOuchy, EXTRA_STOPS.lausanneFlon, EXTRA_STOPS.lausanneSallaz],
  //                 08:10   08:16   08:21
  departureSeconds: [29_400, 29_760, 30_060],
};

/** Tram 12 Genève. */
export const TRAM12_GENEVE: FixtureTripSpec = {
  tripId: 'fixture.tram12.ge',
  serviceDate: SERVICE_DATE,
  routeId: 'fixture-route-tram12',
  routeShortName: '12',
  agencyId: '3851',
  agencyName: 'Transports publics genevois',
  vehicleType: VehicleType.TRAM,
  directionId: 0,
  stops: [EXTRA_STOPS.geneveCornavin, EXTRA_STOPS.geneveBelAir, EXTRA_STOPS.genevePlainpalais],
  //                 12:04   12:08   12:12
  departureSeconds: [43_440, 43_680, 43_920],
};

/** Trolleybus 1 Luzern. */
export const TROLLEY_LUZERN: FixtureTripSpec = {
  tripId: 'fixture.trolley1.lu',
  serviceDate: SERVICE_DATE,
  routeId: 'fixture-route-trolley1',
  routeShortName: '1',
  agencyId: '3852',
  agencyName: 'Verkehrsbetriebe Luzern',
  vehicleType: VehicleType.TROLLEYBUS,
  directionId: 0,
  stops: [EXTRA_STOPS.luzernBahnhofplatz, EXTRA_STOPS.luzernKantonalbank],
  //                 15:20   15:24
  departureSeconds: [55_200, 55_440],
};

/** PostAuto 141 Göschenen → Andermatt (Bergstrecke, enge Kurven). */
export const POSTAUTO_ANDERMATT: FixtureTripSpec = {
  tripId: 'fixture.postauto.141',
  serviceDate: SERVICE_DATE,
  routeId: 'fixture-route-pa141',
  routeShortName: '141',
  agencyId: '801',
  agencyName: 'PostAuto Schweiz',
  vehicleType: VehicleType.BUS,
  directionId: 0,
  stops: [EXTRA_STOPS.goschenen, EXTRA_STOPS.andermatt],
  //                 09:35   09:50
  departureSeconds: [34_500, 35_400],
};

/** Kursschiff Zürichsee Bürkliplatz → Thalwil. */
export const SHIP_ZURICHSEE: FixtureTripSpec = {
  tripId: 'fixture.ship.zsg',
  serviceDate: SERVICE_DATE,
  routeId: 'fixture-route-zsg',
  routeShortName: 'Kurs 1',
  agencyId: '3890',
  agencyName: 'Zürichsee-Schifffahrtsgesellschaft',
  vehicleType: VehicleType.FERRY,
  directionId: 0,
  stops: [EXTRA_STOPS.zurichBurkliplatz, EXTRA_STOPS.thalwil],
  //                 14:00   14:45
  departureSeconds: [50_400, 53_100],
};

/** Luftseilbahn Weggis → Rigi Kaltbad. */
export const AERIAL_RIGI: FixtureTripSpec = {
  tripId: 'fixture.lsb.rigi',
  serviceDate: SERVICE_DATE,
  routeId: 'fixture-route-rigi',
  routeShortName: 'LSB',
  agencyId: '3891',
  agencyName: 'Rigi Bahnen',
  vehicleType: VehicleType.AERIAL_LIFT,
  directionId: 0,
  stops: [EXTRA_STOPS.weggis, EXTRA_STOPS.rigiKaltbad],
  //                 10:00   10:10
  departureSeconds: [36_000, 36_600],
};

/** Polybahn Zürich (Standseilbahn, 176 m Länge). */
export const POLYBAHN_ZURICH: FixtureTripSpec = {
  tripId: 'fixture.polybahn.zh',
  serviceDate: SERVICE_DATE,
  routeId: 'fixture-route-polybahn',
  routeShortName: 'PB',
  agencyId: '3849',
  agencyName: 'Polybahn',
  vehicleType: VehicleType.FUNICULAR,
  directionId: 0,
  stops: [FIXTURE_STOPS.zurichCentral, EXTRA_STOPS.zurichPolyterrasse],
  //                 17:36   17:38
  departureSeconds: [63_360, 63_480],
};

// ---------------------------------------------------------------------------
// Geometrie-Hilfen für Falsch-Positiv-Szenarien
// ---------------------------------------------------------------------------

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Verschiebt einen Punkt um `meters` senkrecht zur Achse `from → to`.
 *
 * Damit lassen sich Situationen bauen, die es in der Schweiz überall gibt:
 * die Autobahn neben der Bahnlinie, die Strasse über dem Metrotunnel, der
 * Radweg entlang der Tramstrecke.
 */
export function offsetPerpendicular(
  point: { lat: number; lon: number },
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  meters: number,
): { lat: number; lon: number } {
  const bearing = bearingDegrees(from, to);
  const perpendicular = ((bearing + 90) * Math.PI) / 180;
  const dLat = (Math.cos(perpendicular) * meters) / METERS_PER_DEGREE_LAT;
  const dLon =
    (Math.sin(perpendicular) * meters) /
    (METERS_PER_DEGREE_LAT * Math.cos((point.lat * Math.PI) / 180));
  return { lat: point.lat + dLat, lon: point.lon + dLon };
}

/** Punkt auf der Geraden zwischen zwei Halten. */
export function pointBetween(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  fraction: number,
): { lat: number; lon: number } {
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lon: from.lon + (to.lon - from.lon) * fraction,
  };
}

export interface ObservationOptions {
  accuracyMeters?: number;
  /** `null` bedeutet ausdrücklich „unbekannt" — wie es Browser liefern. */
  speedMps?: number | null;
  headingDegrees?: number | null;
}

/**
 * Baut eine Beobachtung an einer Position, optional seitlich versetzt.
 *
 * `offsetMeters` ist der Abstand zur Linie: 0 = im Fahrzeug, 180 = Auto auf
 * der parallelen Autobahn, 25 = Trottoir neben dem Tram.
 */
export function observationNear(
  from: FixtureStop,
  to: FixtureStop,
  fraction: number,
  timestamp: Date,
  offsetMeters = 0,
  options: ObservationOptions = {},
): Observation {
  const base = pointBetween(from, to, fraction);
  const position = offsetMeters === 0 ? base : offsetPerpendicular(base, from, to, offsetMeters);
  const segmentDistance = haversineMeters(from, to);

  // `Observation` kennt für unbekannte Werte `undefined`, nicht `null` — die
  // Unterscheidung ist wichtig, weil ein `0` als „steht still" gewertet würde.
  return {
    lat: position.lat,
    lon: position.lon,
    accuracyMeters: options.accuracyMeters ?? 12,
    ...(options.headingDegrees === null
      ? {}
      : { headingDegrees: options.headingDegrees ?? bearingDegrees(from, to) }),
    ...(options.speedMps === null
      ? {}
      : { speedMps: options.speedMps ?? segmentDistance / 900 }),
    timestamp,
  };
}

/**
 * Zeitpunkt eines Betriebstags als `Date`.
 *
 * Nutzt bewusst dieselbe Funktion wie der Produktivcode: würde der Test die
 * Zeitzone selbst rechnen, prüfte er seine eigene Annahme statt der
 * Implementierung — und wäre bei der Sommerzeitumstellung falsch.
 */
export function atServiceSeconds(seconds: number, serviceDate = SERVICE_DATE): Date {
  return serviceDateTimeToUtc(serviceDate, seconds);
}
