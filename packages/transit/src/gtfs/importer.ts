import type { Database } from '@swissov/database';
import { normalizeGtfsDate, parseGtfsTime } from '@swissov/shared';
import type pg from 'pg';
import { forEachEntry, downloadArchive } from './archive.js';
import { copyRows, pointEwkt, type CopyValue } from './copy.js';
import { gtfsBoolean, gtfsFloat, gtfsInt, readCsv } from './csv.js';

/**
 * GTFS-Static-Import (§5).
 *
 * Ablauf:
 *   1. Archiv streamend herunterladen und Prüfsumme bilden.
 *   2. Neue Feed-Version anlegen (Status IMPORTING).
 *   3. Dateien einzeln per COPY einlesen.
 *   4. Geometrien und denormalisierte Felder berechnen.
 *   5. Statistiken aktualisieren (ANALYZE).
 *   6. Version atomar aktivieren; die vorherige wird SUPERSEDED.
 *
 * Während des gesamten Imports bleibt die bisherige Version aktiv und
 * ausgeliefert — es entsteht keine Ausfallzeit.
 */

export const GTFS_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'shapes.txt',
  'transfers.txt',
  'feed_info.txt',
] as const;

export interface ImportOptions {
  url: string;
  apiKey?: string | undefined;
  log?: (message: string) => void;
  /** Import auch dann durchführen, wenn die Prüfsumme unverändert ist. */
  force?: boolean;
  /** Anzahl älterer Feed-Versionen, die aufbewahrt werden. */
  keepSuperseded?: number;
  /** Nur die ersten N Zeilen je Datei lesen — ausschliesslich für Diagnose. */
  rowLimit?: number;
}

export interface ImportResult {
  feedId: string;
  status: 'IMPORTED' | 'UNCHANGED';
  checksum: string;
  counts: Record<string, number>;
  durationMs: number;
}

interface Counters {
  [table: string]: number;
}

export async function importGtfsStatic(
  db: Database,
  options: ImportOptions,
): Promise<ImportResult> {
  const log = options.log ?? (() => undefined);
  const startedAt = Date.now();

  log(`GTFS-Import gestartet: ${options.url}`);
  const download = await downloadArchive(options.url, { apiKey: options.apiKey });
  log(
    `Archiv geladen: ${(download.sizeBytes / 1024 / 1024).toFixed(1)} MB, ` +
      `sha256=${download.checksum.slice(0, 12)}…`,
  );

  try {
    if (!options.force) {
      const existing = await db.queryOne<{ id: string }>(
        `SELECT id FROM transit.gtfs_imports
         WHERE checksum = $1 AND status = 'ACTIVE' LIMIT 1`,
        [download.checksum],
      );
      if (existing) {
        log('Feed ist unverändert — Import übersprungen.');
        return {
          feedId: existing.id,
          status: 'UNCHANGED',
          checksum: download.checksum,
          counts: {},
          durationMs: Date.now() - startedAt,
        };
      }
    }

    const created = await db.queryOne<{ id: string }>(
      `INSERT INTO transit.gtfs_imports (source_url, checksum, status)
       VALUES ($1, $2, 'IMPORTING') RETURNING id`,
      [options.url, download.checksum],
    );
    if (!created) throw new Error('Feed-Version konnte nicht angelegt werden');
    const feedId = created.id;
    log(`Feed-Version ${feedId} angelegt.`);

    try {
      const counts = await loadArchive(db, feedId, download.filePath, options);
      await postProcess(db, feedId, log);
      await activate(db, feedId, counts, log);
      await pruneOldFeeds(db, options.keepSuperseded ?? 2, log);

      const durationMs = Date.now() - startedAt;
      log(`✓ Import abgeschlossen in ${(durationMs / 1000).toFixed(1)} s.`);
      return { feedId, status: 'IMPORTED', checksum: download.checksum, counts, durationMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.query(
        `UPDATE transit.gtfs_imports
         SET status = 'FAILED', error = $2, finished_at = now()
         WHERE id = $1`,
        [feedId, message.slice(0, 2000)],
      );
      throw error;
    }
  } finally {
    await download.cleanup();
  }
}

async function loadArchive(
  db: Database,
  feedId: string,
  zipPath: string,
  options: ImportOptions,
): Promise<Counters> {
  const log = options.log ?? (() => undefined);
  const counts: Counters = {};
  const client = await db.rawPool.connect();

  try {
    // Staging-Tabellen für die beiden Dateien, aus denen Geometrien entstehen.
    await client.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS transit.stg_stops (
        stop_id text, code text, name text, description text,
        lat double precision, lon double precision,
        location_type smallint, parent_station text, platform_code text,
        timezone text, wheelchair_boarding smallint
      )`);
    await client.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS transit.stg_shape_points (
        shape_id text, seq integer, lat double precision, lon double precision
      )`);
    await client.query('TRUNCATE transit.stg_stops, transit.stg_shape_points');

    const seen = await forEachEntry(zipPath, GTFS_FILES, async ({ fileName, stream }) => {
      const rows = readCsv(stream, options.rowLimit ? { limit: options.rowLimit } : {});
      const started = Date.now();
      let inserted = 0;

      switch (fileName.toLowerCase()) {
        case 'agency.txt':
          inserted = await copyRows(
            client,
            'transit.agencies',
            ['feed_id', 'agency_id', 'name', 'url', 'timezone', 'lang', 'phone'],
            map(rows, (row) => [
              feedId,
              // agency_id ist optional, wenn der Feed nur eine Agentur enthält.
              row.get('agency_id') ?? 'default',
              row.getRequired('agency_name'),
              row.get('agency_url'),
              row.get('agency_timezone') ?? 'Europe/Zurich',
              row.get('agency_lang'),
              row.get('agency_phone'),
            ]),
          );
          break;

        case 'stops.txt':
          inserted = await copyRows(
            client,
            'transit.stg_stops',
            [
              'stop_id',
              'code',
              'name',
              'description',
              'lat',
              'lon',
              'location_type',
              'parent_station',
              'platform_code',
              'timezone',
              'wheelchair_boarding',
            ],
            filterMap(rows, (row) => {
              const lat = gtfsFloat(row.get('stop_lat'));
              const lon = gtfsFloat(row.get('stop_lon'));
              // Halte ohne Koordinaten sind für Geo-Abfragen wertlos.
              if (lat === null || lon === null) return null;
              return [
                row.getRequired('stop_id'),
                row.get('stop_code'),
                row.get('stop_name') ?? row.getRequired('stop_id'),
                row.get('stop_desc'),
                lat,
                lon,
                gtfsInt(row.get('location_type'), 0),
                row.get('parent_station'),
                row.get('platform_code'),
                row.get('stop_timezone'),
                gtfsInt(row.get('wheelchair_boarding'), 0),
              ];
            }),
          );
          break;

        case 'routes.txt':
          inserted = await copyRows(
            client,
            'transit.routes',
            [
              'feed_id',
              'route_id',
              'agency_id',
              'short_name',
              'long_name',
              'description',
              'route_type',
              'color',
              'text_color',
              'sort_order',
            ],
            map(rows, (row) => [
              feedId,
              row.getRequired('route_id'),
              row.get('agency_id') ?? 'default',
              row.get('route_short_name'),
              row.get('route_long_name'),
              row.get('route_desc'),
              gtfsInt(row.get('route_type'), 3),
              normalizeColor(row.get('route_color')),
              normalizeColor(row.get('route_text_color')),
              gtfsInt(row.get('route_sort_order')),
            ]),
          );
          break;

        case 'trips.txt':
          inserted = await copyRows(
            client,
            'transit.trips',
            [
              'feed_id',
              'trip_id',
              'route_id',
              'service_id',
              'headsign',
              'short_name',
              'direction_id',
              'block_id',
              'shape_id',
              'wheelchair_accessible',
              'bikes_allowed',
            ],
            map(rows, (row) => [
              feedId,
              row.getRequired('trip_id'),
              row.getRequired('route_id'),
              row.getRequired('service_id'),
              row.get('trip_headsign'),
              row.get('trip_short_name'),
              gtfsInt(row.get('direction_id')),
              row.get('block_id'),
              row.get('shape_id'),
              gtfsInt(row.get('wheelchair_accessible')),
              gtfsInt(row.get('bikes_allowed')),
            ]),
          );
          break;

        case 'stop_times.txt':
          inserted = await copyRows(
            client,
            'transit.stop_times',
            [
              'feed_id',
              'trip_id',
              'stop_sequence',
              'stop_id',
              'arrival_seconds',
              'departure_seconds',
              'stop_headsign',
              'pickup_type',
              'drop_off_type',
              'shape_dist_traveled',
            ],
            filterMap(rows, (row) => {
              const sequence = gtfsInt(row.get('stop_sequence'));
              if (sequence === null) return null;
              const arrival = row.get('arrival_time');
              const departure = row.get('departure_time');
              return [
                feedId,
                row.getRequired('trip_id'),
                sequence,
                row.getRequired('stop_id'),
                arrival ? parseGtfsTime(arrival) : null,
                departure ? parseGtfsTime(departure) : null,
                row.get('stop_headsign'),
                gtfsInt(row.get('pickup_type'), 0),
                gtfsInt(row.get('drop_off_type'), 0),
                gtfsFloat(row.get('shape_dist_traveled')),
              ];
            }),
            { onProgress: (n) => log(`  stop_times: ${n.toLocaleString('de-CH')} Zeilen …`) },
          );
          break;

        case 'calendar.txt':
          inserted = await copyRows(
            client,
            'transit.calendar',
            [
              'feed_id',
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
            map(rows, (row) => [
              feedId,
              row.getRequired('service_id'),
              gtfsBoolean(row.get('monday')),
              gtfsBoolean(row.get('tuesday')),
              gtfsBoolean(row.get('wednesday')),
              gtfsBoolean(row.get('thursday')),
              gtfsBoolean(row.get('friday')),
              gtfsBoolean(row.get('saturday')),
              gtfsBoolean(row.get('sunday')),
              normalizeGtfsDate(row.getRequired('start_date')),
              normalizeGtfsDate(row.getRequired('end_date')),
            ]),
          );
          break;

        case 'calendar_dates.txt':
          inserted = await copyRows(
            client,
            'transit.calendar_dates',
            ['feed_id', 'service_id', 'date', 'exception_type'],
            map(rows, (row) => [
              feedId,
              row.getRequired('service_id'),
              normalizeGtfsDate(row.getRequired('date')),
              gtfsInt(row.get('exception_type'), 1),
            ]),
          );
          break;

        case 'shapes.txt':
          inserted = await copyRows(
            client,
            'transit.stg_shape_points',
            ['shape_id', 'seq', 'lat', 'lon'],
            filterMap(rows, (row) => {
              const lat = gtfsFloat(row.get('shape_pt_lat'));
              const lon = gtfsFloat(row.get('shape_pt_lon'));
              const seq = gtfsInt(row.get('shape_pt_sequence'));
              if (lat === null || lon === null || seq === null) return null;
              return [row.getRequired('shape_id'), seq, lat, lon];
            }),
            { onProgress: (n) => log(`  shapes: ${n.toLocaleString('de-CH')} Punkte …`) },
          );
          break;

        case 'transfers.txt':
          inserted = await copyRows(
            client,
            'transit.transfers',
            ['feed_id', 'from_stop_id', 'to_stop_id', 'transfer_type', 'min_transfer_time'],
            filterMap(rows, (row) => {
              const from = row.get('from_stop_id');
              const to = row.get('to_stop_id');
              if (!from || !to) return null;
              return [
                feedId,
                from,
                to,
                gtfsInt(row.get('transfer_type'), 0),
                gtfsInt(row.get('min_transfer_time')),
              ];
            }),
          );
          break;

        case 'feed_info.txt':
          inserted = await copyRows(
            client,
            'transit.feed_info',
            ['feed_id', 'publisher_name', 'publisher_url', 'lang', 'start_date', 'end_date', 'version'],
            map(rows, (row) => [
              feedId,
              row.get('feed_publisher_name'),
              row.get('feed_publisher_url'),
              row.get('feed_lang'),
              optionalDate(row.get('feed_start_date')),
              optionalDate(row.get('feed_end_date')),
              row.get('feed_version'),
            ]),
          );
          break;

        default:
          return;
      }

      counts[fileName] = inserted;
      log(
        `  ${fileName}: ${inserted.toLocaleString('de-CH')} Zeilen in ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    });

    const missing = ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'].filter(
      (name) => !seen.some((s) => s.toLowerCase() === name),
    );
    if (missing.length > 0) {
      throw new Error(`Das Archiv enthält keine ${missing.join(', ')} — kein gültiger GTFS-Feed.`);
    }

    await materializeStops(client, feedId, log);
    await materializeShapes(client, feedId, log);
  } finally {
    client.release();
  }

  return counts;
}

async function materializeStops(
  client: pg.PoolClient,
  feedId: string,
  log: (message: string) => void,
): Promise<void> {
  const started = Date.now();
  const result = await client.query(
    `INSERT INTO transit.stops (
       feed_id, stop_id, code, name, description, geom, geom_lv95,
       location_type, parent_station, platform_code, timezone, wheelchair_boarding
     )
     SELECT
       $1,
       s.stop_id,
       s.code,
       s.name,
       s.description,
       ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326)::geography,
       ST_Transform(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326), 2056),
       COALESCE(s.location_type, 0),
       s.parent_station,
       s.platform_code,
       s.timezone,
       COALESCE(s.wheelchair_boarding, 0)
     FROM transit.stg_stops s
     -- Doppelte stop_id kommen in realen Feeds vereinzelt vor.
     WHERE s.stop_id IS NOT NULL
     ON CONFLICT (feed_id, stop_id) DO NOTHING`,
    [feedId],
  );
  await client.query('TRUNCATE transit.stg_stops');
  log(`  stops materialisiert: ${result.rowCount} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

async function materializeShapes(
  client: pg.PoolClient,
  feedId: string,
  log: (message: string) => void,
): Promise<void> {
  const started = Date.now();
  await client.query(
    'CREATE INDEX IF NOT EXISTS stg_shape_points_idx ON transit.stg_shape_points (shape_id, seq)',
  );
  const result = await client.query(
    `INSERT INTO transit.shapes (feed_id, shape_id, geom, geom_lv95, length_m)
     SELECT
       $1,
       p.shape_id,
       p.line,
       ST_Transform(p.line, 2056),
       ST_Length(ST_Transform(p.line, 2056))
     FROM (
       SELECT
         shape_id,
         ST_SetSRID(ST_MakeLine(ST_MakePoint(lon, lat) ORDER BY seq), 4326) AS line
       FROM transit.stg_shape_points
       GROUP BY shape_id
       HAVING count(*) >= 2
     ) p
     ON CONFLICT (feed_id, shape_id) DO NOTHING`,
    [feedId],
  );
  await client.query('TRUNCATE transit.stg_shape_points');
  log(
    `  shapes materialisiert: ${result.rowCount} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
}

/** Denormalisierte Felder auf `trips` berechnen (Abfahrtszeiten, Start/Ziel). */
async function postProcess(
  db: Database,
  feedId: string,
  log: (message: string) => void,
): Promise<void> {
  const started = Date.now();

  await db.query(
    `UPDATE transit.trips t SET
       start_seconds = agg.start_seconds,
       end_seconds = agg.end_seconds,
       first_stop_id = agg.first_stop_id,
       last_stop_id = agg.last_stop_id,
       stop_count = agg.stop_count
     FROM (
       SELECT
         trip_id,
         min(COALESCE(departure_seconds, arrival_seconds)) AS start_seconds,
         max(COALESCE(arrival_seconds, departure_seconds)) AS end_seconds,
         (array_agg(stop_id ORDER BY stop_sequence))[1] AS first_stop_id,
         (array_agg(stop_id ORDER BY stop_sequence DESC))[1] AS last_stop_id,
         count(*)::integer AS stop_count
       FROM transit.stop_times
       WHERE feed_id = $1
       GROUP BY trip_id
     ) agg
     WHERE t.feed_id = $1 AND t.trip_id = agg.trip_id`,
    [feedId],
  );

  await db.query(
    `UPDATE transit.trips t SET
       first_stop_name = s1.name,
       last_stop_name = s2.name
     FROM transit.stops s1, transit.stops s2
     WHERE t.feed_id = $1
       AND s1.feed_id = $1 AND s1.stop_id = t.first_stop_id
       AND s2.feed_id = $1 AND s2.stop_id = t.last_stop_id`,
    [feedId],
  );

  // Fahrten ohne Halte sind unbrauchbar und würden die Kandidatensuche stören.
  const orphans = await db.query(
    'DELETE FROM transit.trips WHERE feed_id = $1 AND start_seconds IS NULL',
    [feedId],
  );
  if (orphans.rowCount > 0) log(`  ${orphans.rowCount} Fahrten ohne Halte entfernt.`);

  await db.query(
    `UPDATE transit.gtfs_imports SET
       feed_version = COALESCE((SELECT version FROM transit.feed_info WHERE feed_id = $1), feed_version),
       feed_start_date = (SELECT start_date FROM transit.feed_info WHERE feed_id = $1),
       feed_end_date = (SELECT end_date FROM transit.feed_info WHERE feed_id = $1)
     WHERE id = $1`,
    [feedId],
  );

  log(`  Nachbearbeitung abgeschlossen (${((Date.now() - started) / 1000).toFixed(1)} s).`);

  // Ohne aktuelle Statistiken wählt der Planer für die Kandidatensuche
  // regelmässig Sequential Scans — der Unterschied liegt bei Faktor 100+.
  await db.query('ANALYZE transit.stops');
  await db.query('ANALYZE transit.trips');
  await db.query('ANALYZE transit.stop_times');
  await db.query('ANALYZE transit.shapes');
  await db.query('ANALYZE transit.routes');
  await db.query('ANALYZE transit.calendar');
  await db.query('ANALYZE transit.calendar_dates');
  log('  Statistiken aktualisiert.');
}

async function activate(
  db: Database,
  feedId: string,
  counts: Counters,
  log: (message: string) => void,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE transit.gtfs_imports SET status = 'SUPERSEDED' WHERE status = 'ACTIVE' AND id <> $1`,
      [feedId],
    );
    await tx.query(
      `UPDATE transit.gtfs_imports
       SET status = 'ACTIVE', activated_at = now(), finished_at = now(), stats = $2::jsonb
       WHERE id = $1`,
      [feedId, JSON.stringify(counts)],
    );
  });
  log(`  Feed-Version ${feedId} ist jetzt aktiv.`);

  await db.query(
    `INSERT INTO transit.feed_health (component, last_success_at, last_attempt_at, consecutive_failures, metrics)
     VALUES ('gtfs_static', now(), now(), 0, $1::jsonb)
     ON CONFLICT (component) DO UPDATE SET
       last_success_at = now(), last_attempt_at = now(),
       consecutive_failures = 0, last_error = NULL,
       metrics = EXCLUDED.metrics, updated_at = now()`,
    [JSON.stringify(counts)],
  );
}

/** Alte Feed-Versionen entfernen — sonst wächst die Datenbank unbegrenzt. */
async function pruneOldFeeds(
  db: Database,
  keep: number,
  log: (message: string) => void,
): Promise<void> {
  const result = await db.query(
    `DELETE FROM transit.gtfs_imports
     WHERE id IN (
       SELECT id FROM transit.gtfs_imports
       WHERE status IN ('SUPERSEDED', 'FAILED')
       ORDER BY started_at DESC
       OFFSET $1
     )`,
    [keep],
  );
  if (result.rowCount > 0) log(`  ${result.rowCount} alte Feed-Version(en) entfernt.`);
}

// --- Hilfsfunktionen ---------------------------------------------------------

async function* map<T, R>(
  source: AsyncIterable<T>,
  fn: (item: T) => R,
): AsyncGenerator<R> {
  for await (const item of source) yield fn(item);
}

async function* filterMap<T>(
  source: AsyncIterable<T>,
  fn: (item: T) => readonly CopyValue[] | null,
): AsyncGenerator<readonly CopyValue[]> {
  for await (const item of source) {
    const mapped = fn(item);
    if (mapped !== null) yield mapped;
  }
}

function normalizeColor(value: string | null): string | null {
  if (!value) return null;
  const hex = value.replace('#', '').trim();
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : null;
}

function optionalDate(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizeGtfsDate(value);
  } catch {
    return null;
  }
}

export { pointEwkt };
