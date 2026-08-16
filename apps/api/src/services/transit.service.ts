import type { Database } from '@swissov/database';
import { AppError, ErrorCode, type Candidate } from '@swissov/shared';
import {
  vehicleTypeFromRouteType,
  type Departure,
  type ServiceAlert,
  type Stop,
  type Trip,
  type TripStop,
} from '@swissov/types';
import { cacheKeys, cached, type Cache } from '../lib/cache.js';

/**
 * Zugriff auf die importierten Fahrplandaten.
 *
 * Sämtliche Geo- und Fahrplanabfragen laufen als parametrisierte Queries bzw.
 * über die SQL-Funktionen aus Migration 0008 — der Client erhält nie mehr als
 * das angefragte Ergebnis (§37/§47).
 */
export class TransitService {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
  ) {}

  async activeFeedId(): Promise<string | null> {
    return cached(this.cache, cacheKeys.activeFeed(), 30, async () => {
      const row = await this.db.queryOne<{ id: string | null }>(
        'SELECT transit.active_feed_id() AS id',
      );
      return row?.id ?? null;
    });
  }

  private async assertFeed(): Promise<string> {
    const feedId = await this.activeFeedId();
    if (!feedId) throw new AppError(ErrorCode.NO_ACTIVE_FEED);
    return feedId;
  }

  async stopsNearby(
    lat: number,
    lon: number,
    radiusMeters: number,
    limit: number,
    parentsOnly = true,
  ): Promise<Stop[]> {
    await this.assertFeed();
    return cached(
      this.cache,
      `${cacheKeys.stopsNearby(lat, lon, radiusMeters)}:${limit}:${parentsOnly}`,
      120,
      async () => {
        const { rows } = await this.db.query<NearbyStopRow>(
          'SELECT * FROM transit.stops_nearby($1, $2, $3, $4, $5)',
          [lat, lon, radiusMeters, limit, parentsOnly],
        );
        const stops = rows.map(toStop);
        await this.attachVehicleTypes(stops);
        return stops;
      },
    );
  }

  /** Ergänzt je Haltestelle die bedienenden Verkehrsmittel (für Icons/Filter). */
  private async attachVehicleTypes(stops: Stop[]): Promise<void> {
    if (stops.length === 0) return;
    const feedId = await this.assertFeed();
    const { rows } = await this.db.query<{ stop_id: string; route_types: number[] }>(
      `SELECT parent.stop_id, array_agg(DISTINCT r.route_type) AS route_types
       FROM transit.stops parent
       JOIN transit.stops child
         ON child.feed_id = parent.feed_id
        AND (child.stop_id = parent.stop_id OR child.parent_station = parent.stop_id)
       JOIN transit.stop_times st ON st.feed_id = parent.feed_id AND st.stop_id = child.stop_id
       JOIN transit.trips t ON t.feed_id = parent.feed_id AND t.trip_id = st.trip_id
       JOIN transit.routes r ON r.feed_id = parent.feed_id AND r.route_id = t.route_id
       WHERE parent.feed_id = $1 AND parent.stop_id = ANY ($2::text[])
       GROUP BY parent.stop_id`,
      [feedId, toPgArray(stops.map((s) => s.stopId))],
    );
    const byStop = new Map(rows.map((row) => [row.stop_id, row.route_types]));
    for (const stop of stops) {
      const types = byStop.get(stop.stopId);
      if (types) {
        stop.vehicleTypes = [...new Set(types.map((t) => vehicleTypeFromRouteType(t)))];
      }
    }
  }

  async getStop(stopId: string): Promise<Stop | null> {
    const feedId = await this.assertFeed();
    const row = await this.db.queryOne<NearbyStopRow>(
      `SELECT stop_id, name, code, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon,
              location_type, parent_station, platform_code, wheelchair_boarding,
              NULL::double precision AS distance_m
       FROM transit.stops WHERE feed_id = $1 AND stop_id = $2`,
      [feedId, stopId],
    );
    if (!row) return null;
    const stop = toStop(row);
    await this.attachVehicleTypes([stop]);
    return stop;
  }

  /** Alle Halte-IDs einer Station inklusive Kanten/Gleise. */
  private async resolveStopFamily(stopId: string): Promise<string[]> {
    const feedId = await this.assertFeed();
    const { rows } = await this.db.query<{ stop_id: string }>(
      `SELECT stop_id FROM transit.stops
       WHERE feed_id = $1 AND (stop_id = $2 OR parent_station = $2)`,
      [feedId, stopId],
    );
    return rows.length > 0 ? rows.map((r) => r.stop_id) : [stopId];
  }

  async getDepartures(stopId: string, at: Date, limit: number): Promise<Departure[]> {
    await this.assertFeed();
    // Zeitfenster in 30-Sekunden-Buckets cachen: identische Anfragen kurz
    // hintereinander treffen denselben Eintrag, ohne dass Daten veralten.
    const bucket = Math.floor(at.getTime() / 30_000);
    return cached(this.cache, `${cacheKeys.departures(stopId, bucket)}:${limit}`, 25, async () => {
      const family = await this.resolveStopFamily(stopId);
      const { rows } = await this.db.query<DepartureRow>(
        'SELECT * FROM transit.departures($1::text[], $2, $3, $4)',
        [toPgArray(family), at.toISOString(), 180, limit],
      );
      if (rows.length === 0) return [];

      const realtime = await this.realtimeForTrips(rows.map((r) => ({ tripId: r.trip_id, serviceDate: r.service_date })));

      return rows.map((row) => {
        const rt = realtime.get(`${row.trip_id}|${row.service_date}`);
        const scheduled = new Date(row.scheduled_departure);
        const delay = rt?.delay_seconds ?? null;
        return {
          tripId: row.trip_id,
          serviceDate: row.service_date,
          stopId: row.stop_id,
          stopName: row.stop_name,
          platformCode: row.platform_code,
          routeId: row.route_id,
          routeShortName: row.route_short_name,
          routeColor: row.route_color,
          vehicleType: vehicleTypeFromRouteType(row.route_type),
          agencyName: row.agency_name,
          headsign: row.headsign ?? row.destination_name,
          directionId: row.direction_id,
          scheduledDeparture: scheduled.toISOString(),
          realtimeDeparture:
            delay !== null ? new Date(scheduled.getTime() + delay * 1000).toISOString() : null,
          delaySeconds: delay,
          cancelled: rt?.cancelled ?? false,
        } satisfies Departure;
      });
    });
  }

  async getTrip(tripId: string, serviceDate: string): Promise<Trip | null> {
    const feedId = await this.assertFeed();
    const header = await this.db.queryOne<TripHeaderRow>(
      `SELECT t.trip_id, t.route_id, t.headsign, t.direction_id,
              t.first_stop_name, t.last_stop_name,
              r.short_name AS route_short_name, r.long_name AS route_long_name,
              r.color AS route_color, r.route_type, r.agency_id, a.name AS agency_name
       FROM transit.trips t
       JOIN transit.routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
       LEFT JOIN transit.agencies a ON a.feed_id = t.feed_id AND a.agency_id = r.agency_id
       WHERE t.feed_id = $1 AND t.trip_id = $2`,
      [feedId, tripId],
    );
    if (!header) return null;

    const { rows: stopRows } = await this.db.query<TripStopRow>(
      `SELECT st.stop_sequence, st.stop_id, s.name AS stop_name, s.platform_code,
              ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lon,
              transit.service_time($3::date, st.arrival_seconds) AS scheduled_arrival,
              transit.service_time($3::date, st.departure_seconds) AS scheduled_departure
       FROM transit.stop_times st
       JOIN transit.stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id
       WHERE st.feed_id = $1 AND st.trip_id = $2
       ORDER BY st.stop_sequence`,
      [feedId, tripId, serviceDate],
    );

    const rtUpdate = await this.db.queryOne<{
      id: string;
      delay_seconds: number | null;
      schedule_relationship: string;
    }>(
      `SELECT id, delay_seconds, schedule_relationship
       FROM transit.realtime_trip_updates WHERE trip_id = $1 AND start_date = $2`,
      [tripId, serviceDate],
    );

    const stopUpdates = new Map<number, RealtimeStopUpdateRow>();
    if (rtUpdate) {
      const { rows } = await this.db.query<RealtimeStopUpdateRow>(
        `SELECT stop_sequence, arrival_time, arrival_delay, departure_time, departure_delay,
                schedule_relationship
         FROM transit.realtime_stop_time_updates WHERE trip_update_id = $1`,
        [rtUpdate.id],
      );
      for (const row of rows) stopUpdates.set(row.stop_sequence, row);
    }

    const tripDelay = rtUpdate?.delay_seconds ?? null;

    const stops: TripStop[] = stopRows.map((row) => {
      const update = stopUpdates.get(row.stop_sequence);
      const scheduledArrival = row.scheduled_arrival ? new Date(row.scheduled_arrival) : null;
      const scheduledDeparture = row.scheduled_departure ? new Date(row.scheduled_departure) : null;

      const arrivalDelay = update?.arrival_delay ?? tripDelay;
      const departureDelay = update?.departure_delay ?? tripDelay;

      const realtimeArrival =
        update?.arrival_time ??
        (scheduledArrival && arrivalDelay !== null
          ? new Date(scheduledArrival.getTime() + arrivalDelay * 1000).toISOString()
          : null);
      const realtimeDeparture =
        update?.departure_time ??
        (scheduledDeparture && departureDelay !== null
          ? new Date(scheduledDeparture.getTime() + departureDelay * 1000).toISOString()
          : null);

      return {
        stopId: row.stop_id,
        stopName: row.stop_name,
        stopSequence: row.stop_sequence,
        lat: row.lat,
        lon: row.lon,
        platformCode: row.platform_code,
        scheduledArrival: scheduledArrival?.toISOString() ?? null,
        scheduledDeparture: scheduledDeparture?.toISOString() ?? null,
        realtimeArrival: realtimeArrival ? new Date(realtimeArrival).toISOString() : null,
        realtimeDeparture: realtimeDeparture ? new Date(realtimeDeparture).toISOString() : null,
        delaySeconds: arrivalDelay ?? departureDelay,
        skipped: update?.schedule_relationship === 'DELETED',
      } satisfies TripStop;
    });

    return {
      tripId: header.trip_id,
      serviceDate,
      routeId: header.route_id,
      routeShortName: header.route_short_name,
      routeLongName: header.route_long_name,
      routeColor: header.route_color,
      agencyId: header.agency_id,
      agencyName: header.agency_name,
      vehicleType: vehicleTypeFromRouteType(header.route_type),
      headsign: header.headsign,
      directionId: header.direction_id,
      origin: header.first_stop_name,
      destination: header.last_stop_name,
      delaySeconds: tripDelay,
      cancelled: rtUpdate?.schedule_relationship === 'CANCELED',
      stops,
    };
  }

  /** Echtzeitdaten für mehrere Fahrten in einem Rutsch. */
  async realtimeForTrips(
    keys: Array<{ tripId: string; serviceDate: string }>,
  ): Promise<Map<string, { delay_seconds: number | null; cancelled: boolean; received_at: Date }>> {
    const result = new Map<string, { delay_seconds: number | null; cancelled: boolean; received_at: Date }>();
    if (keys.length === 0) return result;

    const { rows } = await this.db.query<{
      trip_id: string;
      start_date: string;
      delay_seconds: number | null;
      schedule_relationship: string;
      received_at: Date;
    }>(
      `SELECT trip_id, start_date::text, delay_seconds, schedule_relationship, received_at
       FROM transit.realtime_trip_updates
       WHERE trip_id = ANY ($1::text[])`,
      [toPgArray([...new Set(keys.map((k) => k.tripId))])],
    );

    for (const row of rows) {
      result.set(`${row.trip_id}|${row.start_date}`, {
        delay_seconds: row.delay_seconds,
        cancelled: row.schedule_relationship === 'CANCELED',
        received_at: row.received_at,
      });
    }
    return result;
  }

  /** Rohdaten für die Fahrtenerkennung; die Bewertung passiert in @swissov/shared. */
  async findTripCandidates(params: {
    lat: number;
    lon: number;
    at: Date;
    radiusMeters: number;
    limit: number;
    previous?: { lat: number; lon: number } | undefined;
    routeTypes?: number[] | undefined;
  }): Promise<Candidate[]> {
    await this.assertFeed();
    const { rows } = await this.db.query<CandidateRow>(
      'SELECT * FROM transit.find_trip_candidates($1, $2, $3, $4, $5, $6, $7, $8::integer[])',
      [
        params.lat,
        params.lon,
        params.at.toISOString(),
        params.radiusMeters,
        params.limit,
        params.previous?.lat ?? null,
        params.previous?.lon ?? null,
        params.routeTypes && params.routeTypes.length > 0 ? `{${params.routeTypes.join(',')}}` : null,
      ],
    );
    if (rows.length === 0) return [];

    const realtime = await this.realtimeForTrips(
      rows.map((r) => ({ tripId: r.trip_id, serviceDate: r.service_date })),
    );

    return rows.map((row) => {
      const rt = realtime.get(`${row.trip_id}|${row.service_date}`);
      return {
        tripId: row.trip_id,
        serviceDate: row.service_date,
        routeId: row.route_id,
        routeShortName: row.route_short_name,
        routeLongName: row.route_long_name,
        routeColor: row.route_color,
        agencyId: row.agency_id,
        agencyName: row.agency_name,
        vehicleType: vehicleTypeFromRouteType(row.route_type),
        headsign: row.headsign,
        directionId: row.direction_id,
        origin: row.origin_name,
        destination: row.destination_name,
        scheduledStart: new Date(row.scheduled_start),
        scheduledEnd: new Date(row.scheduled_end),
        projection:
          row.distance_m === null
            ? null
            : {
                distanceMeters: row.distance_m,
                fraction: row.fraction ?? 0,
                bearingDegrees: row.bearing_deg,
                shapeLengthMeters: row.shape_length_m ?? 0,
              },
        previousProjection:
          row.prev_distance_m === null || row.prev_fraction === null
            ? null
            : {
                distanceMeters: row.prev_distance_m,
                fraction: row.prev_fraction,
                bearingDegrees: row.bearing_deg,
                shapeLengthMeters: row.shape_length_m ?? 0,
              },
        previousStop: row.prev_stop_id
          ? {
              stopId: row.prev_stop_id,
              stopName: row.prev_stop_name ?? row.prev_stop_id,
              stopSequence: row.prev_stop_sequence ?? 0,
              lat: row.prev_stop_lat ?? 0,
              lon: row.prev_stop_lon ?? 0,
              scheduledArrival: row.prev_stop_departure ? new Date(row.prev_stop_departure) : null,
              scheduledDeparture: row.prev_stop_departure ? new Date(row.prev_stop_departure) : null,
            }
          : null,
        nextStop: row.next_stop_id
          ? {
              stopId: row.next_stop_id,
              stopName: row.next_stop_name ?? row.next_stop_id,
              stopSequence: row.next_stop_sequence ?? 0,
              lat: row.next_stop_lat ?? 0,
              lon: row.next_stop_lon ?? 0,
              scheduledArrival: row.next_stop_arrival ? new Date(row.next_stop_arrival) : null,
              scheduledDeparture: row.next_stop_arrival ? new Date(row.next_stop_arrival) : null,
            }
          : null,
        expectedPosition:
          row.expected_lat !== null && row.expected_lon !== null
            ? { lat: row.expected_lat, lon: row.expected_lon }
            : null,
        realtime: rt
          ? { delaySeconds: rt.delay_seconds, cancelled: rt.cancelled, updatedAt: rt.received_at }
          : null,
        stopCount: row.stop_count,
      } satisfies Candidate;
    });
  }

  async search(query: string, limit: number): Promise<SearchResultRow[]> {
    await this.assertFeed();
    if (query.trim().length < 2) return [];
    return cached(this.cache, `${cacheKeys.search(query)}:${limit}`, 300, async () => {
      const { rows } = await this.db.query<SearchResultRow>(
        'SELECT * FROM transit.search_places($1, $2) ORDER BY score DESC',
        [query.trim().slice(0, 100), limit],
      );
      return rows;
    });
  }

  /** Aktive offizielle Störungsmeldungen, optional gefiltert. */
  async activeAlerts(filter: {
    routeIds?: string[];
    stopIds?: string[];
    tripIds?: string[];
    limit?: number;
  } = {}): Promise<ServiceAlert[]> {
    const hasFilter =
      (filter.routeIds?.length ?? 0) + (filter.stopIds?.length ?? 0) + (filter.tripIds?.length ?? 0) > 0;

    const { rows } = await this.db.query<AlertRow>(
      `SELECT a.id, a.alert_id, a.cause, a.effect, a.severity, a.header, a.description, a.url,
              a.active_from, a.active_until, a.updated_at,
              COALESCE(array_agg(DISTINCT e.route_id) FILTER (WHERE e.route_id IS NOT NULL), '{}') AS route_ids,
              COALESCE(array_agg(DISTINCT e.stop_id) FILTER (WHERE e.stop_id IS NOT NULL), '{}') AS stop_ids,
              COALESCE(array_agg(DISTINCT e.trip_id) FILTER (WHERE e.trip_id IS NOT NULL), '{}') AS trip_ids,
              COALESCE(array_agg(DISTINCT e.agency_id) FILTER (WHERE e.agency_id IS NOT NULL), '{}') AS agency_ids
       FROM transit.service_alerts a
       LEFT JOIN transit.service_alert_entities e ON e.alert_id = a.id
       WHERE a.removed_at IS NULL
         AND (a.active_from IS NULL OR a.active_from <= now())
         AND (a.active_until IS NULL OR a.active_until >= now())
         AND (
           NOT $1::boolean
           OR e.route_id = ANY ($2::text[])
           OR e.stop_id = ANY ($3::text[])
           OR e.trip_id = ANY ($4::text[])
         )
       GROUP BY a.id
       ORDER BY
         CASE a.severity WHEN 'SEVERE' THEN 0 WHEN 'WARNING' THEN 1 WHEN 'INFO' THEN 2 ELSE 3 END,
         a.updated_at DESC
       LIMIT $5`,
      [
        hasFilter,
        toPgArray(filter.routeIds ?? []),
        toPgArray(filter.stopIds ?? []),
        toPgArray(filter.tripIds ?? []),
        filter.limit ?? 50,
      ],
    );

    return rows.map((row) => ({
      id: row.alert_id,
      source: 'OFFICIAL' as const,
      severity: row.severity,
      cause: row.cause,
      effect: row.effect,
      header: row.header,
      description: row.description,
      url: row.url,
      activeFrom: row.active_from ? new Date(row.active_from).toISOString() : null,
      activeUntil: row.active_until ? new Date(row.active_until).toISOString() : null,
      affectedRouteIds: row.route_ids,
      affectedStopIds: row.stop_ids,
      affectedTripIds: row.trip_ids,
      affectedAgencyIds: row.agency_ids,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
}

// --- Hilfsfunktionen und Zeilentypen ----------------------------------------

/**
 * Baut ein PostgreSQL-Array-Literal. Jeder Wert wird quotiert und escaped —
 * die Werte stammen aus GTFS-IDs bzw. validierter Nutzereingabe und werden
 * zusätzlich als Parameter ($n) übergeben, nie in SQL interpoliert.
 */
export function toPgArray(values: readonly string[]): string {
  if (values.length === 0) return '{}';
  return `{${values
    .map((value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
    .join(',')}}`;
}

function toStop(row: NearbyStopRow): Stop {
  return {
    stopId: row.stop_id,
    name: row.name,
    code: row.code,
    lat: row.lat,
    lon: row.lon,
    locationType: row.location_type,
    parentStation: row.parent_station,
    platformCode: row.platform_code,
    wheelchairBoarding: row.wheelchair_boarding,
    distanceMeters: row.distance_m === null ? null : Math.round(row.distance_m),
  };
}

interface NearbyStopRow {
  stop_id: string;
  name: string;
  code: string | null;
  lat: number;
  lon: number;
  location_type: number;
  parent_station: string | null;
  platform_code: string | null;
  wheelchair_boarding: number;
  distance_m: number | null;
}

interface DepartureRow {
  trip_id: string;
  service_date: string;
  stop_id: string;
  stop_name: string;
  platform_code: string | null;
  route_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_color: string | null;
  route_type: number;
  agency_name: string | null;
  headsign: string | null;
  direction_id: number | null;
  destination_name: string | null;
  scheduled_departure: string;
}

interface TripHeaderRow {
  trip_id: string;
  route_id: string;
  headsign: string | null;
  direction_id: number | null;
  first_stop_name: string | null;
  last_stop_name: string | null;
  route_short_name: string | null;
  route_long_name: string | null;
  route_color: string | null;
  route_type: number;
  agency_id: string | null;
  agency_name: string | null;
}

interface TripStopRow {
  stop_sequence: number;
  stop_id: string;
  stop_name: string;
  platform_code: string | null;
  lat: number;
  lon: number;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
}

interface RealtimeStopUpdateRow {
  stop_sequence: number;
  arrival_time: string | null;
  arrival_delay: number | null;
  departure_time: string | null;
  departure_delay: number | null;
  schedule_relationship: string;
}

interface CandidateRow {
  trip_id: string;
  service_date: string;
  route_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_color: string | null;
  route_type: number;
  agency_id: string | null;
  agency_name: string | null;
  headsign: string | null;
  direction_id: number | null;
  origin_name: string | null;
  destination_name: string | null;
  stop_count: number;
  scheduled_start: string;
  scheduled_end: string;
  distance_m: number | null;
  fraction: number | null;
  bearing_deg: number | null;
  shape_length_m: number | null;
  prev_distance_m: number | null;
  prev_fraction: number | null;
  prev_stop_id: string | null;
  prev_stop_name: string | null;
  prev_stop_sequence: number | null;
  prev_stop_lat: number | null;
  prev_stop_lon: number | null;
  prev_stop_departure: string | null;
  next_stop_id: string | null;
  next_stop_name: string | null;
  next_stop_sequence: number | null;
  next_stop_lat: number | null;
  next_stop_lon: number | null;
  next_stop_arrival: string | null;
  expected_lat: number | null;
  expected_lon: number | null;
}

export interface SearchResultRow {
  kind: 'STOP' | 'ROUTE';
  id: string;
  name: string;
  subtitle: string | null;
  lat: number | null;
  lon: number | null;
  route_type: number | null;
  score: number;
}

interface AlertRow {
  id: string;
  alert_id: string;
  cause: string | null;
  effect: string | null;
  severity: 'UNKNOWN' | 'INFO' | 'WARNING' | 'SEVERE';
  header: { de: string; fr?: string; it?: string; en?: string };
  description: { de: string; fr?: string; it?: string; en?: string } | null;
  url: string | null;
  active_from: string | null;
  active_until: string | null;
  updated_at: string;
  route_ids: string[];
  stop_ids: string[];
  trip_ids: string[];
  agency_ids: string[];
}
