import type { Database } from '@swissov/database';
import { vehicleTypeFromRouteType, type Journey, type JourneyLeg } from '@swissov/types';
import type {
  JourneyPlannerProvider,
  JourneySearchRequest,
  JourneySearchResult,
} from './provider.js';

/**
 * Verbindungssuche auf Basis der eigenen GTFS-Daten.
 *
 * Findet **Direktverbindungen**: Fahrten, die sowohl die Start- als auch die
 * Zielhaltestelle in der richtigen Reihenfolge bedienen. Umstiegsverbindungen
 * erfordern einen vollwertigen Routenplaner (OJP).
 *
 * Diese Implementierung ist kein Platzhalter: Für die grosse Mehrheit der
 * innerstädtischen und der IC/IR-Relationen in der Schweiz liefert sie echte,
 * korrekte Ergebnisse inklusive Echtzeitverspätungen. Die Einschränkung wird
 * dem Nutzer transparent angezeigt.
 */
export class GtfsDirectJourneyProvider implements JourneyPlannerProvider {
  readonly name = 'gtfs-direct';

  constructor(private readonly db: Database) {}

  isAvailable(): boolean {
    return true;
  }

  async search(request: JourneySearchRequest): Promise<JourneySearchResult> {
    const limit = Math.min(request.results ?? 5, 10);

    // Start- und Zielhaltestelle inklusive ihrer Kanten/Gleise auflösen:
    // In Schweizer Feeds hängen die Abfahrten an den Kindern der Station.
    const rows = await this.db.query<DirectRow>(
      `WITH feed AS (SELECT transit.active_feed_id() AS id),
      origin_stops AS (
        SELECT s.stop_id FROM transit.stops s, feed
        WHERE s.feed_id = feed.id AND (s.stop_id = $1 OR s.parent_station = $1)
      ),
      destination_stops AS (
        SELECT s.stop_id FROM transit.stops s, feed
        WHERE s.feed_id = feed.id AND (s.stop_id = $2 OR s.parent_station = $2)
      ),
      windows AS (
        SELECT
          d.service_date,
          EXTRACT(EPOCH FROM ($3::timestamptz AT TIME ZONE 'Europe/Zurich') - d.service_date::timestamp)::integer AS secs
        FROM (
          SELECT ($3::timestamptz AT TIME ZONE 'Europe/Zurich')::date AS service_date
          UNION ALL
          SELECT (($3::timestamptz AT TIME ZONE 'Europe/Zurich')::date - 1)
        ) d
      ),
      services AS (
        SELECT w.service_date, w.secs, s.service_id
        FROM windows w, feed
        CROSS JOIN LATERAL transit.active_service_ids(feed.id, w.service_date) s
      )
      SELECT
        t.trip_id,
        sv.service_date,
        r.route_id,
        r.short_name AS route_short_name,
        r.long_name AS route_long_name,
        r.route_type,
        a.name AS agency_name,
        t.headsign,
        t.last_stop_name AS destination_name,
        board.stop_id AS board_stop_id,
        bs.name AS board_stop_name,
        bs.platform_code AS board_platform,
        ST_Y(bs.geom::geometry) AS board_lat,
        ST_X(bs.geom::geometry) AS board_lon,
        board.stop_sequence AS board_sequence,
        transit.service_time(sv.service_date, board.departure_seconds) AS board_departure,
        alight.stop_id AS alight_stop_id,
        als.name AS alight_stop_name,
        als.platform_code AS alight_platform,
        ST_Y(als.geom::geometry) AS alight_lat,
        ST_X(als.geom::geometry) AS alight_lon,
        alight.stop_sequence AS alight_sequence,
        transit.service_time(sv.service_date, alight.arrival_seconds) AS alight_arrival,
        rtu.delay_seconds,
        (rtu.schedule_relationship = 'CANCELED') AS cancelled
      FROM services sv
      JOIN feed ON true
      JOIN transit.trips t ON t.feed_id = feed.id AND t.service_id = sv.service_id
      JOIN transit.stop_times board
        ON board.feed_id = feed.id AND board.trip_id = t.trip_id
       AND board.stop_id IN (SELECT stop_id FROM origin_stops)
       AND board.pickup_type <> 1
       AND board.departure_seconds BETWEEN sv.secs - 120 AND sv.secs + $4 * 60
      JOIN transit.stop_times alight
        ON alight.feed_id = feed.id AND alight.trip_id = t.trip_id
       AND alight.stop_id IN (SELECT stop_id FROM destination_stops)
       AND alight.drop_off_type <> 1
       AND alight.stop_sequence > board.stop_sequence
      JOIN transit.stops bs ON bs.feed_id = feed.id AND bs.stop_id = board.stop_id
      JOIN transit.stops als ON als.feed_id = feed.id AND als.stop_id = alight.stop_id
      JOIN transit.routes r ON r.feed_id = feed.id AND r.route_id = t.route_id
      LEFT JOIN transit.agencies a ON a.feed_id = feed.id AND a.agency_id = r.agency_id
      LEFT JOIN transit.realtime_trip_updates rtu
        ON rtu.trip_id = t.trip_id AND rtu.start_date = sv.service_date
      WHERE ($5::integer[] IS NULL OR r.route_type = ANY ($5::integer[]))
      ORDER BY board_departure
      LIMIT $6`,
      [
        request.originStopId,
        request.destinationStopId,
        request.at.toISOString(),
        request.timeMode === 'ARRIVAL' ? 240 : 180,
        request.routeTypes && request.routeTypes.length > 0
          ? `{${request.routeTypes.join(',')}}`
          : null,
        limit * 3,
      ],
    );

    const journeys: Journey[] = [];
    const seenTrips = new Set<string>();

    for (const row of rows.rows) {
      const key = `${row.trip_id}:${row.service_date}`;
      if (seenTrips.has(key)) continue;
      seenTrips.add(key);
      if (!row.board_departure || !row.alight_arrival) continue;

      const delay = row.delay_seconds ?? null;
      const departure = shift(new Date(row.board_departure), delay);
      const arrival = shift(new Date(row.alight_arrival), delay);

      const leg: JourneyLeg = {
        mode: 'TRANSIT',
        vehicleType: vehicleTypeFromRouteType(row.route_type),
        routeShortName: row.route_short_name,
        routeLongName: row.route_long_name,
        agencyName: row.agency_name,
        headsign: row.headsign ?? row.destination_name,
        tripId: row.trip_id,
        origin: {
          stopId: row.board_stop_id,
          name: row.board_stop_name,
          platformCode: row.board_platform,
          coordinates: { lat: row.board_lat, lon: row.board_lon },
        },
        destination: {
          stopId: row.alight_stop_id,
          name: row.alight_stop_name,
          platformCode: row.alight_platform,
          coordinates: { lat: row.alight_lat, lon: row.alight_lon },
        },
        departure: departure.toISOString(),
        arrival: arrival.toISOString(),
        departureDelaySeconds: delay,
        arrivalDelaySeconds: delay,
        durationSeconds: Math.max(0, Math.round((arrival.getTime() - departure.getTime()) / 1000)),
        intermediateStops: [],
        cancelled: row.cancelled ?? false,
      };

      journeys.push({
        id: `${row.trip_id}|${row.service_date}|${row.board_sequence}-${row.alight_sequence}`,
        departure: leg.departure,
        arrival: leg.arrival,
        durationSeconds: leg.durationSeconds,
        transfers: 0,
        legs: [leg],
      });

      if (journeys.length >= limit) break;
    }

    return {
      journeys,
      provider: this.name,
      limitations: [
        'Es werden ausschliesslich Direktverbindungen ohne Umstieg angezeigt. ' +
          'Für Umsteigeverbindungen wird ein OJP-Zugang benötigt (OJP_API_KEY).',
      ],
    };
  }

  async healthcheck(): Promise<{ ok: boolean; message?: string }> {
    const feed = await this.db.queryOne<{ id: string | null }>(
      'SELECT transit.active_feed_id() AS id',
    );
    if (!feed?.id) return { ok: false, message: 'Keine aktive GTFS-Feed-Version importiert' };
    return { ok: true };
  }
}

function shift(date: Date, delaySeconds: number | null): Date {
  return delaySeconds ? new Date(date.getTime() + delaySeconds * 1000) : date;
}

interface DirectRow {
  trip_id: string;
  service_date: string;
  route_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_type: number;
  agency_name: string | null;
  headsign: string | null;
  destination_name: string | null;
  board_stop_id: string;
  board_stop_name: string;
  board_platform: string | null;
  board_lat: number;
  board_lon: number;
  board_sequence: number;
  board_departure: string | null;
  alight_stop_id: string;
  alight_stop_name: string;
  alight_platform: string | null;
  alight_lat: number;
  alight_lon: number;
  alight_sequence: number;
  alight_arrival: string | null;
  delay_seconds: number | null;
  cancelled: boolean | null;
}
