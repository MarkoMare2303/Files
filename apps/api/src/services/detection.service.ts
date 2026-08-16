import type { Database } from '@swissov/database';
import {
  AppError,
  ErrorCode,
  decideDetection,
  evaluateGpsPlausibility,
  scoreCandidates,
  type Observation,
  type ScoredCandidate,
} from '@swissov/shared';
import type {
  DetectionDecision,
  GpsObservation,
  StartTripSessionInput,
  TripCandidate,
  TripDetectionResponse,
  TripSession,
} from '@swissov/types';
import type { ConfigService } from './config.service.js';
import type { TransitService } from './transit.service.js';

/**
 * Fahrtenerkennung (§10–§12).
 *
 * Die Datenbank liefert Kandidaten (PostGIS), die Bewertung erfolgt mit den
 * reinen Funktionen aus `@swissov/shared`. Diese Trennung macht das Scoring
 * vollständig unit-testbar und erlaubt es der App, dieselbe Logik lokal
 * anzuwenden.
 */
export class DetectionService {
  constructor(
    private readonly db: Database,
    private readonly transit: TransitService,
    private readonly config: ConfigService,
  ) {}

  async detect(
    observations: GpsObservation[],
    options: { radiusMeters?: number; limit?: number; routeTypes?: number[] } = {},
  ): Promise<TripDetectionResponse> {
    const detectionConfig = await this.config.detection();
    const normalized = normalizeObservations(observations);
    const latest = normalized[normalized.length - 1]!;
    const earliest = normalized[0]!;

    // Positionen ausserhalb des Bediengebiets gar nicht erst abfragen.
    const plausibility = evaluateGpsPlausibility({
      position: latest,
      accuracyMeters: latest.accuracyMeters,
    });
    if (plausibility.score === 0) {
      return {
        decision: 'NONE',
        candidates: [],
        thresholds: {
          auto: detectionConfig.autoThreshold,
          confirm: detectionConfig.confirmThreshold,
        },
        evaluatedAt: new Date().toISOString(),
      };
    }

    const radius = clampRadius(options.radiusMeters ?? detectionConfig.defaultRadiusMeters, latest.accuracyMeters);

    const candidates = await this.transit.findTripCandidates({
      lat: latest.lat,
      lon: latest.lon,
      at: latest.timestamp,
      radiusMeters: radius,
      limit: detectionConfig.maxCandidates,
      previous: normalized.length > 1 ? { lat: earliest.lat, lon: earliest.lon } : undefined,
      routeTypes: options.routeTypes,
    });

    const scored = scoreCandidates(candidates, normalized, detectionConfig.weights);
    const thresholds = {
      auto: detectionConfig.autoThreshold,
      confirm: detectionConfig.confirmThreshold,
    };
    const decision: DetectionDecision = decideDetection(scored, thresholds);
    const limit = Math.min(options.limit ?? 5, scored.length);

    return {
      decision,
      candidates: scored.slice(0, limit).map(toTripCandidate),
      thresholds,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // --- Trip-Sessions ---------------------------------------------------------

  async activeSession(userId: string): Promise<TripSession | null> {
    const row = await this.db.queryOne<SessionRow>(
      `SELECT s.id, s.trip_id, s.service_date::text, s.route_id, s.agency_id, s.confidence,
              s.detection_method, s.started_at, s.ended_at, s.following
       FROM public.trip_sessions s
       WHERE s.user_id = $1 AND s.ended_at IS NULL
       ORDER BY s.started_at DESC LIMIT 1`,
      [userId],
    );
    return row ? toSession(row) : null;
  }

  /**
   * Startet eine Fahrt-Sitzung. Eine bestehende offene Sitzung wird beendet —
   * ein Nutzer kann sich nur in einem Fahrzeug gleichzeitig befinden.
   */
  async startSession(userId: string, input: StartTripSessionInput): Promise<TripSession> {
    const trip = await this.transit.getTrip(input.tripId, input.serviceDate);
    if (!trip) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: `Fahrt ${input.tripId} am ${input.serviceDate} nicht gefunden`,
        userMessage: {
          de: 'Diese Fahrt ist im aktuellen Fahrplan nicht mehr vorhanden.',
          en: 'This service is no longer part of the current timetable.',
        },
      });
    }

    const row = await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE public.trip_sessions
         SET ended_at = now(), ended_reason = 'replaced', last_position = NULL
         WHERE user_id = $1 AND ended_at IS NULL`,
        [userId],
      );
      const inserted = await tx.query<SessionRow>(
        `INSERT INTO public.trip_sessions (
           user_id, trip_id, service_date, route_id, agency_id, vehicle_type,
           confidence, detection_method, last_position
         )
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::public.detection_method,
                 CASE WHEN $9::double precision IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography END)
         RETURNING id, trip_id, service_date::text, route_id, agency_id, confidence,
                   detection_method, started_at, ended_at, following`,
        [
          userId,
          input.tripId,
          input.serviceDate,
          trip.routeId,
          trip.agencyId,
          trip.vehicleType,
          input.confidence,
          input.detectionMethod,
          input.observation?.lat ?? null,
          input.observation?.lon ?? null,
        ],
      );
      return inserted.rows[0]!;
    });

    return toSession(row);
  }

  async updateSessionPosition(
    userId: string,
    sessionId: string,
    observation: GpsObservation,
  ): Promise<void> {
    await this.db.query(
      `UPDATE public.trip_sessions
       SET last_seen_at = now(),
           last_position = ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
       WHERE id = $1 AND user_id = $2 AND ended_at IS NULL`,
      [sessionId, userId, observation.lat, observation.lon],
    );
  }

  async endSession(userId: string, sessionId: string, reason = 'user'): Promise<void> {
    // Beim Beenden wird die letzte Position gelöscht — es entsteht keine
    // dauerhafte Bewegungshistorie (§23/§60).
    await this.db.query(
      `UPDATE public.trip_sessions
       SET ended_at = now(), ended_reason = $3, last_position = NULL, following = false
       WHERE id = $1 AND user_id = $2 AND ended_at IS NULL`,
      [sessionId, userId, reason],
    );
    await this.db.query(
      `DELETE FROM public.trip_follows
       WHERE user_id = $1 AND (trip_id, service_date) IN (
         SELECT trip_id, service_date FROM public.trip_sessions WHERE id = $2
       )`,
      [userId, sessionId],
    );
  }

  /** Smart Follow (§25): Benachrichtigungen für die laufende Fahrt. */
  async setFollowing(userId: string, sessionId: string, following: boolean): Promise<TripSession> {
    const session = await this.db.queryOne<SessionRow & { ends_at: string | null }>(
      `SELECT id, trip_id, service_date::text, route_id, agency_id, confidence,
              detection_method, started_at, ended_at, following, NULL::text AS ends_at
       FROM public.trip_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId],
    );
    if (!session) throw new AppError(ErrorCode.NOT_FOUND);

    await this.db.query('UPDATE public.trip_sessions SET following = $3 WHERE id = $1 AND user_id = $2', [
      sessionId,
      userId,
      following,
    ]);

    if (following) {
      // Follow endet automatisch mit dem Ende der Fahrt (§25).
      const trip = await this.transit.getTrip(session.trip_id, session.service_date);
      const lastStop = trip?.stops[trip.stops.length - 1];
      const endsAt = lastStop?.realtimeArrival ?? lastStop?.scheduledArrival;
      const expiresAt = endsAt
        ? new Date(new Date(endsAt).getTime() + 15 * 60_000)
        : new Date(Date.now() + 4 * 3_600_000);

      await this.db.query(
        `INSERT INTO public.trip_follows (user_id, trip_id, service_date, expires_at)
         VALUES ($1, $2, $3::date, $4)
         ON CONFLICT (user_id, trip_id, service_date) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [userId, session.trip_id, session.service_date, expiresAt],
      );
    } else {
      await this.db.query(
        'DELETE FROM public.trip_follows WHERE user_id = $1 AND trip_id = $2 AND service_date = $3::date',
        [userId, session.trip_id, session.service_date],
      );
    }

    return toSession({ ...session, following });
  }

  /**
   * Beendet Sitzungen, deren Fahrt planmässig vorbei ist oder die seit
   * längerem keine Aktualisierung erhalten haben. Läuft im Worker.
   */
  async closeStaleSessions(): Promise<number> {
    const result = await this.db.query(
      `UPDATE public.trip_sessions s
       SET ended_at = now(), ended_reason = 'stale', last_position = NULL, following = false
       WHERE s.ended_at IS NULL
         AND (
           s.last_seen_at < now() - interval '2 hours'
           OR s.started_at < now() - interval '12 hours'
         )`,
    );
    return result.rowCount;
  }
}

// --- Hilfsfunktionen ---------------------------------------------------------

/** Radius an die GPS-Genauigkeit anpassen — im Tunnel hilft ein enger Radius nicht. */
function clampRadius(requested: number, accuracyMeters: number | undefined): number {
  const withAccuracy = accuracyMeters ? Math.max(requested, accuracyMeters * 2) : requested;
  return Math.min(5000, Math.max(150, Math.round(withAccuracy)));
}

export function normalizeObservations(observations: GpsObservation[]): Observation[] {
  return observations
    .map((observation) => ({
      lat: observation.lat,
      lon: observation.lon,
      accuracyMeters: observation.accuracy,
      speedMps: observation.speed,
      headingDegrees: observation.heading,
      timestamp: new Date(observation.timestamp),
    }))
    .filter((observation) => !Number.isNaN(observation.timestamp.getTime()))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function toTripCandidate(scored: ScoredCandidate): TripCandidate {
  const { candidate, breakdown, confidence } = scored;
  const progress =
    candidate.projection && candidate.projection.shapeLengthMeters > 0
      ? Math.min(1, Math.max(0, candidate.projection.fraction))
      : null;

  return {
    tripId: candidate.tripId,
    serviceDate: candidate.serviceDate,
    routeId: candidate.routeId,
    routeShortName: candidate.routeShortName,
    routeLongName: candidate.routeLongName,
    routeColor: candidate.routeColor,
    agencyId: candidate.agencyId,
    agencyName: candidate.agencyName,
    vehicleType: candidate.vehicleType,
    headsign: candidate.headsign,
    directionId: candidate.directionId,
    origin: candidate.origin,
    destination: candidate.destination,
    confidence,
    breakdown: {
      shapeDistance: breakdown.shapeDistance,
      timeCompatibility: breakdown.timeCompatibility,
      directionCompatibility: breakdown.directionCompatibility,
      speedCompatibility: breakdown.speedCompatibility,
      stopSequence: breakdown.stopSequence,
      realtimeCompatibility: breakdown.realtimeCompatibility,
    },
    distanceToShapeMeters: candidate.projection
      ? Math.round(candidate.projection.distanceMeters)
      : null,
    previousStopId: candidate.previousStop?.stopId ?? null,
    previousStopName: candidate.previousStop?.stopName ?? null,
    nextStopId: candidate.nextStop?.stopId ?? null,
    nextStopName: candidate.nextStop?.stopName ?? null,
    nextStopArrival: candidate.nextStop?.scheduledArrival
      ? new Date(
          candidate.nextStop.scheduledArrival.getTime() +
            (candidate.realtime?.delaySeconds ?? 0) * 1000,
        ).toISOString()
      : null,
    delaySeconds: candidate.realtime?.delaySeconds ?? null,
    progress,
  };
}

interface SessionRow {
  id: string;
  trip_id: string;
  service_date: string;
  route_id: string | null;
  agency_id: string | null;
  confidence: number;
  detection_method: 'AUTO_GPS' | 'AUTO_STOP_SEQUENCE' | 'MANUAL';
  started_at: Date;
  ended_at: Date | null;
  following: boolean;
}

function toSession(row: SessionRow): TripSession {
  return {
    id: row.id,
    tripId: row.trip_id,
    serviceDate: row.service_date,
    routeId: row.route_id,
    agencyId: row.agency_id,
    confidence: Number(row.confidence),
    detectionMethod: row.detection_method,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    following: row.following,
  };
}
