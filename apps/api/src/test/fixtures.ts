import type { Database } from '@swissov/database';

/**
 * TESTDATEN — NICHT FÜR DEN PRODUKTIVBETRIEB (§49/§56).
 *
 * Legt einen kleinen, aber vollständigen GTFS-Feed an: echte Koordinaten
 * Schweizer Bahnhöfe, vereinfachte Fahrplanzeiten. Damit lassen sich
 * Geo-Abfragen, Fahrtenerkennung und Abfahrtstafeln gegen eine echte
 * PostGIS-Datenbank testen.
 *
 * Der Feed wird ausschliesslich von Integrationstests verwendet; im
 * Produktivbetrieb entstehen Fahrplandaten nur durch den GTFS-Import.
 */

export const TEST_STOPS = {
  zurichHb: { id: '8503000', name: 'Zürich HB', lat: 47.3779, lon: 8.5403 },
  zurichAltstetten: { id: '8503001', name: 'Zürich Altstetten', lat: 47.3915, lon: 8.4881 },
  lenzburg: { id: '8502113', name: 'Lenzburg', lat: 47.3918, lon: 8.1685 },
  aarau: { id: '8502125', name: 'Aarau', lat: 47.3914, lon: 8.0512 },
  olten: { id: '8500218', name: 'Olten', lat: 47.3519, lon: 7.9077 },
  baselSbb: { id: '8500010', name: 'Basel SBB', lat: 47.5474, lon: 7.5896 },
  zurichBahnhofquai: { id: '8591123', name: 'Zürich, Bahnhofquai/HB', lat: 47.3771, lon: 8.5411 },
  zurichCentral: { id: '8591317', name: 'Zürich, Central', lat: 47.3766, lon: 8.544 },
} as const;

export interface TestFeed {
  feedId: string;
  /** Betriebstag, für den die Fixture-Fahrten verkehren. */
  serviceDate: string;
}

/** Formatiert ein Datum als `YYYY-MM-DD` in Schweizer Ortszeit. */
export function swissDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Sekunden seit lokalem Mitternacht. */
export function secondsSinceMidnight(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
}

export async function seedTestFeed(db: Database, now: Date = new Date()): Promise<TestFeed> {
  const serviceDate = swissDate(now);
  const nowSeconds = secondsSinceMidnight(now);

  // Der IC startet 10 Minuten vor "jetzt", damit die Fahrt gerade läuft.
  const icStart = nowSeconds - 600;
  const tramStart = nowSeconds - 120;

  const feed = await db.queryOne<{ id: string }>(
    `INSERT INTO transit.gtfs_imports (source_url, checksum, status, feed_version, activated_at)
     VALUES ('test://fixture', $1, 'ACTIVE', 'test-fixture', now())
     RETURNING id`,
    [`test-${Date.now()}-${Math.random().toString(36).slice(2)}`],
  );
  if (!feed) throw new Error('Test-Feed konnte nicht angelegt werden');
  const feedId = feed.id;

  await db.query(
    `INSERT INTO transit.agencies (feed_id, agency_id, name, url, timezone)
     VALUES ($1, '11', 'Schweizerische Bundesbahnen SBB', 'https://www.sbb.ch', 'Europe/Zurich'),
            ($1, '3849', 'Verkehrsbetriebe Zürich', 'https://www.vbz.ch', 'Europe/Zurich')`,
    [feedId],
  );

  await db.query(
    `INSERT INTO transit.routes (feed_id, route_id, agency_id, short_name, long_name, route_type, color)
     VALUES ($1, 'r-ic3', '11', 'IC 3', 'Zürich HB – Basel SBB', 102, '#EB0000'),
            ($1, 'r-tram10', '3849', '10', 'Zürich Tram 10', 900, '#0079C7')`,
    [feedId],
  );

  await db.query(
    `INSERT INTO transit.calendar (feed_id, service_id, monday, tuesday, wednesday, thursday, friday,
                                   saturday, sunday, start_date, end_date)
     VALUES ($1, 'daily', true, true, true, true, true, true, true,
             $2::date - 30, $2::date + 30)`,
    [feedId, serviceDate],
  );

  const stops = Object.values(TEST_STOPS);
  for (const stop of stops) {
    await db.query(
      `INSERT INTO transit.stops (feed_id, stop_id, name, geom, geom_lv95, location_type, wheelchair_boarding)
       VALUES ($1, $2, $3,
               ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
               ST_Transform(ST_SetSRID(ST_MakePoint($5, $4), 4326), 2056),
               1, 1)`,
      [feedId, stop.id, stop.name, stop.lat, stop.lon],
    );
  }

  // Streckenverläufe als Linien durch die Halte (mit Zwischenpunkten).
  await insertShape(db, feedId, 'sh-ic3', [
    TEST_STOPS.zurichHb,
    TEST_STOPS.zurichAltstetten,
    TEST_STOPS.lenzburg,
    TEST_STOPS.aarau,
    TEST_STOPS.olten,
    TEST_STOPS.baselSbb,
  ]);
  await insertShape(db, feedId, 'sh-tram10', [
    TEST_STOPS.zurichBahnhofquai,
    TEST_STOPS.zurichCentral,
  ]);

  await db.query(
    `INSERT INTO transit.trips (feed_id, trip_id, route_id, service_id, headsign, direction_id, shape_id)
     VALUES ($1, 't-ic3-1', 'r-ic3', 'daily', 'Basel SBB', 0, 'sh-ic3'),
            ($1, 't-ic3-2', 'r-ic3', 'daily', 'Basel SBB', 0, 'sh-ic3'),
            ($1, 't-tram10-1', 'r-tram10', 'daily', 'Zürich, Central', 0, 'sh-tram10')`,
    [feedId],
  );

  // IC 3: Zürich HB → Basel SBB, ca. 60 Minuten Fahrzeit.
  const icStops: Array<[string, number]> = [
    [TEST_STOPS.zurichHb.id, icStart],
    [TEST_STOPS.zurichAltstetten.id, icStart + 480],
    [TEST_STOPS.lenzburg.id, icStart + 1200],
    [TEST_STOPS.aarau.id, icStart + 1680],
    [TEST_STOPS.olten.id, icStart + 2280],
    [TEST_STOPS.baselSbb.id, icStart + 3600],
  ];
  await insertStopTimes(db, feedId, 't-ic3-1', icStops);

  // Zweite Fahrt derselben Linie, die erst in 20 Minuten losfährt — damit
  // haben Abfahrtstafeln an allen Halten auch künftige Einträge.
  const laterStart = nowSeconds + 1200;
  await insertStopTimes(
    db,
    feedId,
    't-ic3-2',
    icStops.map(([stopId, seconds]) => [stopId, seconds - icStart + laterStart] as [string, number]),
  );

  const tramStops: Array<[string, number]> = [
    [TEST_STOPS.zurichBahnhofquai.id, tramStart],
    [TEST_STOPS.zurichCentral.id, tramStart + 120],
  ];
  await insertStopTimes(db, feedId, 't-tram10-1', tramStops);

  // Denormalisierte Felder wie im echten Import berechnen.
  await db.query(
    `UPDATE transit.trips t SET
       start_seconds = agg.start_seconds, end_seconds = agg.end_seconds,
       first_stop_id = agg.first_stop_id, last_stop_id = agg.last_stop_id,
       stop_count = agg.stop_count
     FROM (
       SELECT trip_id,
              min(COALESCE(departure_seconds, arrival_seconds)) AS start_seconds,
              max(COALESCE(arrival_seconds, departure_seconds)) AS end_seconds,
              (array_agg(stop_id ORDER BY stop_sequence))[1] AS first_stop_id,
              (array_agg(stop_id ORDER BY stop_sequence DESC))[1] AS last_stop_id,
              count(*)::integer AS stop_count
       FROM transit.stop_times WHERE feed_id = $1 GROUP BY trip_id
     ) agg
     WHERE t.feed_id = $1 AND t.trip_id = agg.trip_id`,
    [feedId],
  );
  await db.query(
    `UPDATE transit.trips t SET first_stop_name = s1.name, last_stop_name = s2.name
     FROM transit.stops s1, transit.stops s2
     WHERE t.feed_id = $1 AND s1.feed_id = $1 AND s1.stop_id = t.first_stop_id
       AND s2.feed_id = $1 AND s2.stop_id = t.last_stop_id`,
    [feedId],
  );

  return { feedId, serviceDate };
}

async function insertShape(
  db: Database,
  feedId: string,
  shapeId: string,
  points: ReadonlyArray<{ lat: number; lon: number }>,
): Promise<void> {
  const densified: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let s = 0; s < 10; s += 1) {
      const t = s / 10;
      densified.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  densified.push(points[points.length - 1]!);

  const wkt = `LINESTRING(${densified.map((p) => `${p.lon} ${p.lat}`).join(',')})`;
  await db.query(
    `INSERT INTO transit.shapes (feed_id, shape_id, geom, geom_lv95, length_m)
     VALUES ($1, $2,
             ST_SetSRID(ST_GeomFromText($3), 4326),
             ST_Transform(ST_SetSRID(ST_GeomFromText($3), 4326), 2056),
             ST_Length(ST_Transform(ST_SetSRID(ST_GeomFromText($3), 4326), 2056)))`,
    [feedId, shapeId, wkt],
  );
}

async function insertStopTimes(
  db: Database,
  feedId: string,
  tripId: string,
  stops: Array<[string, number]>,
): Promise<void> {
  for (const [index, [stopId, seconds]] of stops.entries()) {
    await db.query(
      `INSERT INTO transit.stop_times
         (feed_id, trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [feedId, tripId, index + 1, stopId, seconds],
    );
  }
}

/** Entfernt alle Fixture-Feeds. */
export async function clearTestFeeds(db: Database): Promise<void> {
  await db.query(`DELETE FROM transit.gtfs_imports WHERE source_url = 'test://fixture'`);
}
