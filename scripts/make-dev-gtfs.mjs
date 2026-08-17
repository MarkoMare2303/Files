#!/usr/bin/env node
/**
 * Erzeugt einen KLEINEN GTFS-Datensatz für Entwicklung und Verifikation.
 *
 *     node scripts/make-dev-gtfs.mjs [ziel.zip]
 *
 * ⚠️  DAS IST NICHT DER SCHWEIZER FAHRPLAN.
 *
 * Der echte Datensatz kommt von opentransportdata.swiss und wird mit
 * `pnpm gtfs:import` geladen. Dieses Skript existiert aus einem einzigen
 * Grund: Um die gesamte Kette — Import, Suche, Abfahrten, Fahrtenerkennung,
 * Meldungen — ohne Netzzugang und ohne API-Schlüssel Ende zu Ende ausführen
 * zu können. Ein Datensatz, den man nicht importieren kann, ist ein Importer,
 * den niemand getestet hat.
 *
 * Damit die Prüfung etwas wert ist, ist der Datensatz strukturell echt:
 * reale Haltestellenkoordinaten und -nummern, mehrere Verkehrsmittel,
 * Taktverkehr über den ganzen Tag, Streckenverläufe mit Zwischenpunkten,
 * Umsteigebeziehungen, Betriebstage rund um heute. Erfunden sind allein die
 * Fahrplanzeiten.
 *
 * Der Feed trägt `feed_publisher_name = "ENTWICKLUNGSDATEN — NICHT ECHT"`,
 * damit er in der Datenbank und in der Oberfläche als das erkennbar ist,
 * was er ist.
 */
import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

// ---------------------------------------------------------------------------
// Netz
// ---------------------------------------------------------------------------

/** Reale Haltestellen mit ihren offiziellen DIDOK-Nummern. */
const STOPS = {
  zurichHb: ['8503000', 'Zürich HB', 47.3779, 8.5403],
  zurichAltstetten: ['8503001', 'Zürich Altstetten', 47.3915, 8.4881],
  zurichOerlikon: ['8503006', 'Zürich Oerlikon', 47.4118, 8.5442],
  zurichStadelhofen: ['8503003', 'Zürich Stadelhofen', 47.3666, 8.5482],
  stettbach: ['8503004', 'Stettbach', 47.3987, 8.5964],
  uster: ['8503305', 'Uster', 47.3517, 8.7183],
  wetzikon: ['8503307', 'Wetzikon ZH', 47.3266, 8.7973],
  winterthur: ['8506000', 'Winterthur', 47.5003, 8.7238],
  lenzburg: ['8502113', 'Lenzburg', 47.3918, 8.1685],
  aarau: ['8502125', 'Aarau', 47.3914, 8.0512],
  olten: ['8500218', 'Olten', 47.3519, 7.9077],
  liestal: ['8500020', 'Liestal', 47.4842, 7.7315],
  baselSbb: ['8500010', 'Basel SBB', 47.5474, 7.5896],
  bern: ['8507000', 'Bern', 46.949, 7.4396],
  burgdorf: ['8500207', 'Burgdorf', 47.0596, 7.6199],
  luzern: ['8505000', 'Luzern', 47.0502, 8.3103],
  zug: ['8502204', 'Zug', 47.1736, 8.5152],
  geneve: ['8501008', 'Genève', 46.2102, 6.1424],
  nyon: ['8501100', 'Nyon', 46.3839, 6.2384],
  morges: ['8501111', 'Morges', 46.5115, 6.4986],
  lausanne: ['8501120', 'Lausanne', 46.5169, 6.6291],
  fribourg: ['8504100', 'Fribourg/Freiburg', 46.8032, 7.1512],
  lugano: ['8505300', 'Lugano', 46.0053, 8.9471],
  giubiasco: ['8505001', 'Giubiasco', 46.1746, 9.0086],
  bellinzona: ['8505004', 'Bellinzona', 46.1954, 9.0301],
  stGallen: ['8506302', 'St. Gallen', 47.4232, 9.3697],
  gossau: ['8506314', 'Gossau SG', 47.4166, 9.2528],
  chur: ['8509000', 'Chur', 46.8531, 9.5289],
  landquart: ['8509402', 'Landquart', 46.9689, 9.5551],
  sargans: ['8509411', 'Sargans', 47.0459, 9.4437],

  // Stadtverkehr
  zhBahnhofquai: ['8591123', 'Zürich, Bahnhofquai/HB', 47.3771, 8.5411],
  zhCentral: ['8591317', 'Zürich, Central', 47.3766, 8.544],
  zhStampfenbach: ['8591374', 'Zürich, Stampfenbachplatz', 47.3812, 8.5424],
  zhSeilbahn: ['8591383', 'Zürich, Seilbahn Rigiblick', 47.3877, 8.5479],
  bsSbb: ['8589000', 'Basel, Bahnhof SBB', 47.5476, 7.5903],
  bsAeschenplatz: ['8589003', 'Basel, Aeschenplatz', 47.5502, 7.5934],
  bsBarfuesserplatz: ['8589008', 'Basel, Barfüsserplatz', 47.5548, 7.5885],
  thusis: ['8509197', 'Thusis', 46.6975, 9.4405],
};

/**
 * Linien. `headwayMinutes` erzeugt Taktverkehr über den ganzen Betriebstag —
 * ohne den wären Abfahrtstafeln und Fahrtenerkennung nicht prüfbar.
 */
const LINES = [
  {
    routeId: 'ch:ic3',
    shortName: 'IC 3',
    longName: 'Zürich HB – Basel SBB',
    routeType: 102, // Long Distance Trains
    agency: 'sbb',
    color: '1E6BAA',
    stops: ['zurichHb', 'zurichAltstetten', 'lenzburg', 'aarau', 'olten', 'liestal', 'baselSbb'],
    // Fahrzeit je Abschnitt in Minuten.
    legs: [8, 12, 8, 10, 14, 11],
    dwellSeconds: 120,
    firstDeparture: '05:32',
    lastDeparture: '23:32',
    headwayMinutes: 30,
  },
  {
    routeId: 'ch:ic1',
    shortName: 'IC 1',
    longName: 'Bern – Zürich HB',
    routeType: 102,
    agency: 'sbb',
    color: '1E6BAA',
    stops: ['bern', 'burgdorf', 'olten', 'aarau', 'zurichHb'],
    legs: [12, 18, 10, 26],
    dwellSeconds: 120,
    firstDeparture: '05:04',
    lastDeparture: '23:04',
    headwayMinutes: 30,
  },
  {
    routeId: 'ch:ic5',
    shortName: 'IC 5',
    longName: 'Genève – Fribourg',
    routeType: 102,
    agency: 'sbb',
    color: '1E6BAA',
    stops: ['geneve', 'nyon', 'morges', 'lausanne', 'fribourg'],
    legs: [14, 13, 9, 37],
    dwellSeconds: 120,
    firstDeparture: '05:02',
    lastDeparture: '22:02',
    headwayMinutes: 60,
  },
  {
    routeId: 'ch:ic2',
    shortName: 'IC 2',
    longName: 'Lugano – Bellinzona',
    routeType: 102,
    agency: 'sbb',
    color: '1E6BAA',
    stops: ['lugano', 'giubiasco', 'bellinzona'],
    legs: [23, 4],
    dwellSeconds: 90,
    firstDeparture: '05:24',
    lastDeparture: '23:24',
    headwayMinutes: 60,
  },
  {
    routeId: 'ch:ir26',
    shortName: 'IR 26',
    longName: 'Zürich HB – Chur',
    routeType: 103, // Inter Regional Rail
    agency: 'sbb',
    color: '17558A',
    stops: ['zurichHb', 'sargans', 'landquart', 'chur'],
    legs: [55, 12, 8],
    dwellSeconds: 120,
    firstDeparture: '06:07',
    lastDeparture: '22:07',
    headwayMinutes: 60,
  },
  {
    routeId: 'ch:s3',
    shortName: 'S 3',
    longName: 'Zürich HB – Wetzikon',
    routeType: 109, // Suburban Railway
    agency: 'sbb',
    color: '3E84B2',
    stops: ['zurichHb', 'zurichStadelhofen', 'stettbach', 'uster', 'wetzikon'],
    legs: [3, 5, 8, 9],
    dwellSeconds: 60,
    firstDeparture: '05:12',
    lastDeparture: '00:12',
    headwayMinutes: 30,
  },
  {
    routeId: 'ch:s8',
    shortName: 'S 8',
    longName: 'Winterthur – Zürich HB – Zug',
    routeType: 109,
    agency: 'sbb',
    color: '3E84B2',
    stops: ['winterthur', 'zurichOerlikon', 'zurichHb', 'zug'],
    legs: [18, 7, 25],
    dwellSeconds: 60,
    firstDeparture: '05:18',
    lastDeparture: '23:48',
    headwayMinutes: 30,
  },
  {
    routeId: 'ch:s1sg',
    shortName: 'S 1',
    longName: 'St. Gallen – Gossau SG',
    routeType: 109,
    agency: 'sbb',
    color: '3E84B2',
    stops: ['stGallen', 'gossau'],
    legs: [9],
    dwellSeconds: 60,
    firstDeparture: '05:38',
    lastDeparture: '23:38',
    headwayMinutes: 30,
  },
  {
    routeId: 'ch:tram10',
    shortName: '10',
    longName: 'Zürich Bahnhofquai – Rigiblick',
    routeType: 900, // Tram
    agency: 'vbz',
    color: '0E8A6E',
    stops: ['zhBahnhofquai', 'zhCentral', 'zhStampfenbach', 'zhSeilbahn'],
    legs: [2, 2, 3],
    dwellSeconds: 30,
    firstDeparture: '05:06',
    lastDeparture: '00:36',
    headwayMinutes: 7,
  },
  {
    routeId: 'ch:bus50',
    shortName: '50',
    longName: 'Basel SBB – Barfüsserplatz',
    routeType: 700, // Bus
    agency: 'bvb',
    color: 'B4553C',
    stops: ['bsSbb', 'bsAeschenplatz', 'bsBarfuesserplatz'],
    legs: [4, 4],
    dwellSeconds: 30,
    firstDeparture: '05:15',
    lastDeparture: '00:15',
    headwayMinutes: 10,
  },
  {
    routeId: 'ch:pa541',
    shortName: '541',
    longName: 'Chur – Thusis',
    routeType: 700,
    agency: 'postauto',
    color: 'CC5A12',
    stops: ['chur', 'thusis'],
    legs: [35],
    dwellSeconds: 60,
    firstDeparture: '06:00',
    lastDeparture: '20:00',
    headwayMinutes: 60,
  },
];

const AGENCIES = {
  sbb: ['11', 'Schweizerische Bundesbahnen SBB', 'https://www.sbb.ch'],
  vbz: ['3849', 'Verkehrsbetriebe Zürich', 'https://www.vbz.ch'],
  bvb: ['3853', 'Basler Verkehrs-Betriebe', 'https://www.bvb.ch'],
  postauto: ['801', 'PostAuto Schweiz', 'https://www.postauto.ch'],
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const hhmmss = (seconds) =>
  `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
const toSeconds = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
};
const ymd = (date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;

/** Felder mit Komma oder Anführungszeichen müssen nach RFC 4180 gequotet werden. */
const csvField = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = (header, rows) =>
  [header.join(','), ...rows.map((row) => row.map(csvField).join(','))].join('\n') + '\n';

/** Zwischenpunkte entlang der Strecke — ohne sie hätte die Erkennung keine Linie. */
function interpolate(from, to, steps) {
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const t = i / steps;
    points.push([from[2] + (to[2] - from[2]) * t, from[3] + (to[3] - from[3]) * t]);
  }
  return points;
}

// ---------------------------------------------------------------------------
// Dateien erzeugen
// ---------------------------------------------------------------------------

function build() {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 30);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 210);

  const files = {};

  files['agency.txt'] = csv(
    ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
    Object.values(AGENCIES).map(([id, name, url]) => [id, name, url, 'Europe/Zurich', 'de']),
  );

  // --- Haltestellen: Station (location_type 1) plus je ein Steig -----------
  const usedStops = new Set(LINES.flatMap((line) => line.stops));
  const stopRows = [];
  for (const key of usedStops) {
    const [id, name, lat, lon] = STOPS[key];
    stopRows.push([id, id.slice(-3), name, lat.toFixed(6), lon.toFixed(6), 1, '', '', 1]);
    stopRows.push([
      `${id}:0:1`,
      '',
      `${name}, Kante 1`,
      (lat + 0.0002).toFixed(6),
      (lon + 0.0002).toFixed(6),
      0,
      id,
      '1',
      1,
    ]);
  }
  files['stops.txt'] = csv(
    [
      'stop_id',
      'stop_code',
      'stop_name',
      'stop_lat',
      'stop_lon',
      'location_type',
      'parent_station',
      'platform_code',
      'wheelchair_boarding',
    ],
    stopRows,
  );

  files['routes.txt'] = csv(
    [
      'route_id',
      'agency_id',
      'route_short_name',
      'route_long_name',
      'route_type',
      'route_color',
      'route_text_color',
    ],
    LINES.map((line) => [
      line.routeId,
      AGENCIES[line.agency][0],
      line.shortName,
      line.longName,
      line.routeType,
      line.color,
      'FFFFFF',
    ]),
  );

  files['calendar.txt'] = csv(
    [
      'service_id',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'start_date',
      'end_date',
    ],
    [['DAILY', 1, 1, 1, 1, 1, 1, 1, ymd(start), ymd(end)]],
  );

  // Ein Ausnahmetag, damit der Importer den Pfad wirklich durchläuft.
  const exception = new Date(start);
  exception.setUTCDate(exception.getUTCDate() + 1);
  files['calendar_dates.txt'] = csv(
    ['service_id', 'date', 'exception_type'],
    [['DAILY', ymd(exception), 2]],
  );

  // --- Fahrten, Halte und Streckenverläufe ---------------------------------
  const tripRows = [];
  const stopTimeRows = [];
  const shapeRows = [];

  for (const line of LINES) {
    for (const direction of [0, 1]) {
      const stops = direction === 0 ? line.stops : [...line.stops].reverse();
      const legs = direction === 0 ? line.legs : [...line.legs].reverse();
      const shapeId = `${line.routeId}:${direction}`;

      // Streckenverlauf einmal je Richtung.
      if (direction === 0 || true) {
        let sequence = 0;
        let distance = 0;
        for (let i = 0; i < stops.length - 1; i += 1) {
          const from = STOPS[stops[i]];
          const to = STOPS[stops[i + 1]];
          for (const [lat, lon] of interpolate(from, to, 12)) {
            shapeRows.push([shapeId, lat.toFixed(6), lon.toFixed(6), sequence, distance.toFixed(0)]);
            sequence += 1;
            distance += 100;
          }
        }
        const last = STOPS[stops[stops.length - 1]];
        shapeRows.push([
          shapeId,
          last[2].toFixed(6),
          last[3].toFixed(6),
          sequence,
          distance.toFixed(0),
        ]);
      }

      const first = toSeconds(line.firstDeparture);
      const last = toSeconds(line.lastDeparture);
      let run = 0;

      for (let departure = first; departure <= last; departure += line.headwayMinutes * 60) {
        run += 1;
        const tripId = `${line.routeId}:${direction}:${run}`;
        const headsign = STOPS[stops[stops.length - 1]][1];

        tripRows.push([
          line.routeId,
          'DAILY',
          tripId,
          headsign,
          direction,
          shapeId,
          1,
          1,
        ]);

        let clock = departure;
        for (let i = 0; i < stops.length; i += 1) {
          const [stopId] = STOPS[stops[i]];
          const arrival = i === 0 ? clock : clock;
          const depart = i === stops.length - 1 ? clock : clock + line.dwellSeconds;

          stopTimeRows.push([
            tripId,
            hhmmss(arrival),
            hhmmss(depart),
            `${stopId}:0:1`,
            i + 1,
            0,
            0,
            (i * 1000).toFixed(0),
          ]);

          if (i < stops.length - 1) clock = depart + legs[i] * 60;
        }
      }
    }
  }

  files['trips.txt'] = csv(
    [
      'route_id',
      'service_id',
      'trip_id',
      'trip_headsign',
      'direction_id',
      'shape_id',
      'wheelchair_accessible',
      'bikes_allowed',
    ],
    tripRows,
  );

  files['stop_times.txt'] = csv(
    [
      'trip_id',
      'arrival_time',
      'departure_time',
      'stop_id',
      'stop_sequence',
      'pickup_type',
      'drop_off_type',
      'shape_dist_traveled',
    ],
    stopTimeRows,
  );

  files['shapes.txt'] = csv(
    ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled'],
    shapeRows,
  );

  files['transfers.txt'] = csv(
    ['from_stop_id', 'to_stop_id', 'transfer_type', 'min_transfer_time'],
    [
      [STOPS.zurichHb[0], STOPS.zhBahnhofquai[0], 2, 300],
      [STOPS.baselSbb[0], STOPS.bsSbb[0], 2, 240],
      [STOPS.chur[0], STOPS.chur[0], 2, 180],
    ],
  );

  files['feed_info.txt'] = csv(
    [
      'feed_publisher_name',
      'feed_publisher_url',
      'feed_lang',
      'feed_start_date',
      'feed_end_date',
      'feed_version',
    ],
    [
      [
        'ENTWICKLUNGSDATEN — NICHT ECHT',
        'https://opentransportdata.swiss',
        'de',
        ymd(start),
        ymd(end),
        `dev-${ymd(new Date())}`,
      ],
    ],
  );

  return { files, tripRows, stopTimeRows, stopRows };
}

// ---------------------------------------------------------------------------
// ZIP schreiben (store + deflate, ohne externe Abhängigkeit)
// ---------------------------------------------------------------------------

function writeZip(target, files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // Version
    local.writeUInt16LE(0x0800, 6); // UTF-8-Flag
    local.writeUInt16LE(8, 8); // Deflate
    local.writeUInt16LE(0, 10); // Zeit
    local.writeUInt16LE(0x2100, 12); // Datum (2016-08-01, konstant = reproduzierbar)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x2100, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(0, 42);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(Object.keys(files).length, 8);
  endRecord.writeUInt16LE(Object.keys(files).length, 10);
  endRecord.writeUInt32LE(centralBuf.length, 12);
  endRecord.writeUInt32LE(offset, 16);

  mkdirSync(dirname(target), { recursive: true });
  const stream = createWriteStream(target);
  stream.write(Buffer.concat([...chunks, centralBuf, endRecord]));
  stream.end();
  return Buffer.concat([...chunks, centralBuf, endRecord]).length;
}

const target = resolve(process.argv[2] ?? 'tmp/dev-gtfs.zip');
const { files, tripRows, stopTimeRows, stopRows } = build();
const size = writeZip(target, files);

console.log('⚠️  ENTWICKLUNGSDATEN — nicht der echte Schweizer Fahrplan.');
console.log(`✓ ${target}`);
console.log(
  `  ${LINES.length} Linien · ${stopRows.length} Haltestellen-Einträge · ` +
    `${tripRows.length} Fahrten · ${stopTimeRows.length} Halte · ${(size / 1024).toFixed(0)} KB`,
);
console.log('');
console.log('  Importieren mit:');
console.log(`      pnpm gtfs:import --file ${target} --force`);
