import type { Database } from '@swissov/database';
import {
  AbuseSignal,
  AppError,
  ErrorCode,
  ReputationEventType,
  applyReputationEvent,
  checkCooldown,
  checkRateLimit,
  computeExpiresAt,
  computeTrustScore,
  detectDuplicate,
  detectImpossibleTravel,
  detectSpamPattern,
  evaluateGpsPlausibility,
  requiresPreModeration,
  roundCoordinate,
  shouldAutoExpire,
  summarizeFindings,
  type AbuseFinding,
} from '@swissov/shared';
import type {
  CreateReportInput,
  LocalizedText,
  Report,
  ReportCategory,
  ReportQuery,
  ReportScope,
  ReportStatus,
  VehicleType,
} from '@swissov/types';
import { cacheKeys, type Cache } from '../lib/cache.js';
import type { ConfigService } from './config.service.js';
import type { ProfileRow } from './profiles.service.js';
import type { RealtimeBroadcaster } from './realtime.service.js';
import type { TransitService } from './transit.service.js';

export interface RequestMeta {
  ipHash: string | null;
  installId: string | null;
}

export interface CreateReportResult {
  report: Report;
  /** Gesetzt, wenn statt einer neuen Meldung auf eine bestehende verwiesen wird. */
  mergedInto?: string;
  warnings: string[];
}

export class ReportsService {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
    private readonly config: ConfigService,
    private readonly transit: TransitService,
    private readonly realtime: RealtimeBroadcaster,
  ) {}

  // --- Kategorien ------------------------------------------------------------

  async categories(includeInactive = false): Promise<ReportCategory[]> {
    const cacheKey = `${cacheKeys.categories()}:${includeInactive}`;
    const hit = await this.cache.get<ReportCategory[]>(cacheKey);
    if (hit) return hit;

    const { rows } = await this.db.query<CategoryRow>(
      `SELECT id, key, label, description, icon, color, "group", default_scope,
              allowed_scopes::text[] AS allowed_scopes,
              ttl_seconds, ttl_until_trip_end, requires_trip, requires_moderation, severity,
              sort_order, active
       FROM public.report_categories
       WHERE $1::boolean OR active
       ORDER BY sort_order, key`,
      [includeInactive],
    );
    const categories = rows.map(toCategory);
    await this.cache.set(cacheKey, categories, 300);
    return categories;
  }

  async invalidateCategories(): Promise<void> {
    await this.cache.delByPrefix('categories:');
  }

  private async categoryByKey(key: string): Promise<CategoryRow> {
    const row = await this.db.queryOne<CategoryRow>(
      `SELECT id, key, label, description, icon, color, "group", default_scope,
              allowed_scopes::text[] AS allowed_scopes,
              ttl_seconds, ttl_until_trip_end, requires_trip, requires_moderation, severity,
              sort_order, active
       FROM public.report_categories WHERE key = $1 AND active`,
      [key],
    );
    if (!row) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: `Unbekannte Kategorie: ${key}`,
        userMessage: {
          de: 'Diese Meldungsart steht nicht mehr zur Verfügung.',
          en: 'This report category is no longer available.',
        },
      });
    }
    return row;
  }

  // --- Erstellen -------------------------------------------------------------

  async create(
    profile: ProfileRow,
    input: CreateReportInput,
    meta: RequestMeta,
  ): Promise<CreateReportResult> {
    const [rateLimits, moderationConfig, trustConfig] = await Promise.all([
      this.config.rateLimits(),
      this.config.moderation(),
      this.config.trust(),
    ]);

    // Idempotenz für die Offline-Queue (§39): dieselbe clientReportId liefert
    // dieselbe Meldung zurück, statt eine zweite anzulegen.
    if (input.clientReportId) {
      const existing = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM public.reports WHERE user_id = $1 AND client_report_id = $2',
        [profile.id, input.clientReportId],
      );
      if (existing) {
        const report = await this.byId(existing.id, profile.id);
        if (report) return { report, warnings: [] };
      }
    }

    const category = await this.categoryByKey(input.categoryKey);
    const context = await this.resolveContext(profile.id, input);

    if (category.requires_trip && !context.tripId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        message: 'Kategorie erfordert eine Fahrt',
        userMessage: {
          de: 'Für diese Meldung müssen wir zuerst wissen, in welcher Fahrt du unterwegs bist.',
          en: 'For this report we first need to know which service you are on.',
        },
      });
    }

    const scope = this.resolveScope(input.scope, category, context);
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();

    // --- Dublettenprüfung zuerst ---------------------------------------------
    // Eine wiederholte Meldung zum selben Sachverhalt ist keine neue Meldung.
    // Der Hinweis auf die bestehende Meldung ist für den Nutzer hilfreicher als
    // eine Cooldown-Fehlermeldung — deshalb läuft diese Prüfung vor den
    // Rate-Limit-Prüfungen.
    const duplicates = await this.findDuplicates(
      profile.id,
      category.id,
      context,
      rateLimits.duplicateWindowSeconds,
    );
    const duplicateFinding = detectDuplicate({
      existingSimilarByUser: duplicates.byUser !== null,
      existingSimilarByOthers: duplicates.byOthers,
    });
    if (duplicateFinding && duplicates.byUser) {
      const existing = await this.byId(duplicates.byUser, profile.id);
      if (existing) {
        return {
          report: existing,
          mergedInto: duplicates.byUser,
          warnings: [duplicateFinding.userMessage],
        };
      }
    }

    // --- Missbrauchsschutz (§21) ---------------------------------------------
    const findings: Array<AbuseFinding | null> = [];

    const counters = await this.abuseCounters(profile.id);
    findings.push(
      checkRateLimit(
        { count: counters.lastHour, limit: rateLimits.reportsPerHour, windowLabel: 'pro Stunde' },
        AbuseSignal.RATE_LIMIT_REPORTS,
        'Du hast in der letzten Stunde sehr viele Meldungen erstellt. Bitte warte einen Moment.',
      ),
    );
    findings.push(
      checkRateLimit(
        { count: counters.lastDay, limit: rateLimits.reportsPerDay, windowLabel: 'pro Tag' },
        AbuseSignal.RATE_LIMIT_REPORTS,
        'Du hast heute sehr viele Meldungen erstellt. Bitte versuche es morgen wieder.',
      ),
    );
    findings.push(
      checkCooldown({
        lastActionAt: counters.lastCreatedAt,
        cooldownSeconds: rateLimits.reportCooldownSeconds,
        now: new Date(),
      }),
    );
    findings.push(
      detectSpamPattern({
        reportsLast5Minutes: counters.last5Minutes,
        distinctContextsLast5Minutes: counters.distinctContextsLast5Minutes,
        removalRate:
          profile.reports_count > 0 ? profile.removed_reports_count / profile.reports_count : 0,
        accountAgeHours: (Date.now() - profile.created_at.getTime()) / 3_600_000,
      }),
    );

    let gpsPlausibility = 0.5;
    if (input.lat !== undefined && input.lon !== undefined) {
      const plausibility = evaluateGpsPlausibility({
        position: { lat: input.lat, lon: input.lon },
        accuracyMeters: input.accuracy,
        speedMps: input.speed,
        vehicleType: context.vehicleType ?? undefined,
        distanceToRouteMeters: context.distanceToRouteMeters,
      });
      gpsPlausibility = plausibility.score;
      findings.push(...plausibility.findings);

      findings.push(
        detectImpossibleTravel({
          previous: counters.lastPosition,
          current: { lat: input.lat, lon: input.lon, at: observedAt },
        }),
      );
    }

    const summary = summarizeFindings(findings);

    await this.recordAbuseSignals(profile.id, meta, summary.all);

    if (summary.blocked) {
      throw new AppError(ErrorCode.ABUSE_BLOCKED, {
        message: summary.blocking!.message,
        userMessage: { de: summary.blocking!.userMessage },
      });
    }

    // --- Status und Lebensdauer ---------------------------------------------
    let status: ReportStatus = 'ACTIVE';
    if (profile.status === 'SHADOW_FLAGGED') {
      status = 'SHADOWED';
    } else if (
      category.requires_moderation ||
      requiresPreModeration(profile.reputation_score, moderationConfig.preModerationReputationBelow) ||
      summary.flags.length > 0
    ) {
      status = 'PENDING_REVIEW';
    }

    const createdAt = new Date();
    const expiresAt = computeExpiresAt({
      category: { ttlSeconds: category.ttl_seconds, ttlUntilTripEnd: category.ttl_until_trip_end },
      createdAt,
      tripEndsAt: context.tripEndsAt,
    });

    const confidence = computeTrustScore(
      {
        upvotes: 0,
        downvotes: 0,
        createdAt,
        authorReputation: profile.reputation_score,
        hadTripSession: context.tripSessionId !== null,
        tripSessionConfidence: context.tripSessionConfidence,
        gpsPlausibility,
        flagsCount: 0,
        recentReportsByAuthor: counters.lastHour,
      },
      trustConfig,
      createdAt,
    );

    // Position bewusst gerundet speichern (§15/§23).
    const lat = input.lat !== undefined ? roundCoordinate(input.lat) : null;
    const lon = input.lon !== undefined ? roundCoordinate(input.lon) : null;

    const inserted = await this.db.queryOne<{ id: string }>(
      `INSERT INTO public.reports (
         user_id, category_id, scope, status,
         agency_id, route_id, trip_id, service_date, direction_id, vehicle_type,
         stop_id, next_stop_id,
         location, location_lv95,
         message, confidence, trip_session_id, gps_plausibility, client_report_id,
         expires_at, created_at
       )
       VALUES (
         $1, $2, $3::public.report_scope, $4::public.report_status,
         $5, $6, $7, $8, $9, $10,
         $11, $12,
         CASE WHEN $13::double precision IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($14, $13), 4326)::geography END,
         CASE WHEN $13::double precision IS NULL THEN NULL
              ELSE ST_Transform(ST_SetSRID(ST_MakePoint($14, $13), 4326), 2056) END,
         $15, $16, $17, $18, $19,
         $20, $21
       )
       RETURNING id`,
      [
        profile.id,
        category.id,
        scope,
        status,
        context.agencyId,
        context.routeId,
        context.tripId,
        context.serviceDate,
        context.directionId,
        context.vehicleType,
        context.stopId,
        context.nextStopId,
        lat,
        lon,
        input.message ?? null,
        confidence,
        context.tripSessionId,
        gpsPlausibility,
        input.clientReportId ?? null,
        expiresAt,
        createdAt,
      ],
    );
    if (!inserted) throw new AppError(ErrorCode.INTERNAL);

    await this.db.query(
      'UPDATE public.profiles SET reports_count = reports_count + 1 WHERE id = $1',
      [profile.id],
    );
    if (context.tripSessionId) {
      await this.addReputationEvent(profile.id, ReputationEventType.REPORT_CREATED_WITH_SESSION, inserted.id);
    }

    const report = await this.byId(inserted.id, profile.id);
    if (!report) throw new AppError(ErrorCode.INTERNAL);

    // Nur öffentlich sichtbare Meldungen werden verteilt.
    if (status === 'ACTIVE') {
      await this.realtime.broadcastReport(report, 'created');
      await this.enqueueNotifications(report, category, profile.id);
    }

    return { report, warnings: summary.flags.map((f) => f.userMessage) };
  }

  /** Leitet den Fahrt-/Halt-Kontext aus Session, expliziten IDs oder Position ab. */
  private async resolveContext(
    userId: string,
    input: CreateReportInput,
  ): Promise<ReportContext> {
    const context: ReportContext = {
      tripId: null,
      serviceDate: null,
      routeId: null,
      agencyId: null,
      directionId: null,
      vehicleType: null,
      stopId: input.stopId ?? null,
      nextStopId: input.nextStopId ?? null,
      tripSessionId: null,
      tripSessionConfidence: null,
      tripEndsAt: null,
      distanceToRouteMeters: null,
    };

    // 1) Aktive Trip-Session — stärkstes Signal.
    //    Getrennte Abfragen statt eines ungenutzten Parameters: PostgreSQL kann
    //    den Typ eines Parameters, der im Statement nicht vorkommt, nicht ableiten.
    const sessionColumns =
      'id, trip_id, service_date::text AS service_date, route_id, agency_id, vehicle_type, confidence';
    const session = input.tripSessionId
      ? await this.db.queryOne<SessionContextRow>(
          `SELECT ${sessionColumns} FROM public.trip_sessions
           WHERE id = $1 AND user_id = $2 AND ended_at IS NULL`,
          [input.tripSessionId, userId],
        )
      : await this.db.queryOne<SessionContextRow>(
          `SELECT ${sessionColumns} FROM public.trip_sessions
           WHERE user_id = $1 AND ended_at IS NULL
           ORDER BY started_at DESC LIMIT 1`,
          [userId],
        );

    let tripId = input.tripId ?? null;
    let serviceDate = input.serviceDate ?? null;

    if (session && (!tripId || session.trip_id === tripId)) {
      context.tripSessionId = session.id;
      context.tripSessionConfidence = session.confidence;
      tripId = session.trip_id;
      serviceDate = session.service_date;
      context.routeId = session.route_id;
      context.agencyId = session.agency_id;
      context.vehicleType = (session.vehicle_type as VehicleType | null) ?? null;
    }

    if (tripId) {
      context.tripId = tripId;
      context.serviceDate = serviceDate ?? new Date().toISOString().slice(0, 10);
      const trip = await this.transit.getTrip(context.tripId, context.serviceDate);
      if (trip) {
        context.routeId = trip.routeId;
        context.agencyId = trip.agencyId;
        context.directionId = trip.directionId;
        context.vehicleType = trip.vehicleType;
        const lastStop = trip.stops[trip.stops.length - 1];
        const endsAt = lastStop?.realtimeArrival ?? lastStop?.scheduledArrival ?? null;
        context.tripEndsAt = endsAt ? new Date(endsAt) : null;

        // Nächster Halt aus dem Fahrplan, falls nicht angegeben.
        if (!context.nextStopId) {
          const now = Date.now();
          const next = trip.stops.find((stop) => {
            const at = stop.realtimeArrival ?? stop.scheduledArrival;
            return at !== null && new Date(at).getTime() > now;
          });
          context.nextStopId = next?.stopId ?? null;
          const previous = [...trip.stops]
            .reverse()
            .find((stop) => {
              const at = stop.realtimeDeparture ?? stop.scheduledDeparture;
              return at !== null && new Date(at).getTime() <= now;
            });
          if (!context.stopId) context.stopId = previous?.stopId ?? null;
        }
      }
    }

    // 2) Abstand zur Strecke für die Plausibilitätsprüfung.
    if (context.tripId && input.lat !== undefined && input.lon !== undefined) {
      const row = await this.db.queryOne<{ distance_m: number | null }>(
        `SELECT ST_Distance(sh.geom_lv95, ST_Transform(ST_SetSRID(ST_MakePoint($3, $2), 4326), 2056)) AS distance_m
         FROM transit.trips t
         JOIN transit.shapes sh ON sh.feed_id = t.feed_id AND sh.shape_id = t.shape_id
         WHERE t.feed_id = transit.active_feed_id() AND t.trip_id = $1`,
        [context.tripId, input.lat, input.lon],
      );
      context.distanceToRouteMeters = row?.distance_m ?? null;
    }

    return context;
  }

  private resolveScope(
    requested: ReportScope | undefined,
    category: CategoryRow,
    context: ReportContext,
  ): ReportScope {
    const allowed = category.allowed_scopes;
    // NETWORK ist der Moderation vorbehalten (§16).
    const candidate = requested && allowed.includes(requested) && requested !== 'NETWORK'
      ? requested
      : category.default_scope;

    // Fällt der Standard-Scope mangels Bezug aus, wird auf einen passenden
    // erlaubten Scope zurückgefallen, statt die Meldung abzulehnen.
    if (candidate === 'VEHICLE_TRIP' && !context.tripId) {
      if (context.stopId && allowed.includes('STATION')) return 'STATION';
      if (context.stopId && allowed.includes('STOP')) return 'STOP';
    }
    if ((candidate === 'STOP' || candidate === 'STATION') && !context.stopId) {
      if (context.tripId && allowed.includes('VEHICLE_TRIP')) return 'VEHICLE_TRIP';
    }
    return candidate === 'NETWORK' ? category.default_scope : candidate;
  }

  private async abuseCounters(userId: string): Promise<AbuseCounters> {
    const row = await this.db.queryOne<{
      last_hour: number;
      last_day: number;
      last_5_minutes: number;
      distinct_contexts: number;
      last_created_at: Date | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour,
         count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_day,
         count(*) FILTER (WHERE created_at > now() - interval '5 minutes')::int AS last_5_minutes,
         count(DISTINCT COALESCE(trip_id, stop_id, route_id))
           FILTER (WHERE created_at > now() - interval '5 minutes')::int AS distinct_contexts,
         max(created_at) AS last_created_at
       FROM public.reports WHERE user_id = $1`,
      [userId],
    );

    const lastPositionRow = await this.db.queryOne<{ lat: number; lon: number; created_at: Date }>(
      `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon, created_at
       FROM public.reports
       WHERE user_id = $1 AND location IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    return {
      lastHour: row?.last_hour ?? 0,
      lastDay: row?.last_day ?? 0,
      last5Minutes: row?.last_5_minutes ?? 0,
      distinctContextsLast5Minutes: row?.distinct_contexts ?? 0,
      lastCreatedAt: row?.last_created_at ?? null,
      lastPosition: lastPositionRow
        ? { lat: lastPositionRow.lat, lon: lastPositionRow.lon, at: lastPositionRow.created_at }
        : null,
    };
  }

  private async findDuplicates(
    userId: string,
    categoryId: string,
    context: ReportContext,
    windowSeconds: number,
  ): Promise<{ byUser: string | null; byOthers: number }> {
    const { rows } = await this.db.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM public.reports
       WHERE category_id = $1
         AND status IN ('ACTIVE', 'PENDING_REVIEW', 'SHADOWED')
         AND created_at > now() - make_interval(secs => $2)
         AND (
           ($3::text IS NOT NULL AND trip_id = $3 AND service_date = $4::date)
           OR ($3::text IS NULL AND $5::text IS NOT NULL AND stop_id = $5)
         )`,
      [categoryId, windowSeconds, context.tripId, context.serviceDate, context.stopId],
    );
    const byUser = rows.find((row) => row.user_id === userId);
    return {
      byUser: byUser?.id ?? null,
      byOthers: rows.filter((row) => row.user_id !== userId).length,
    };
  }

  private async recordAbuseSignals(
    userId: string,
    meta: RequestMeta,
    findings: AbuseFinding[],
  ): Promise<void> {
    for (const finding of findings) {
      await this.db.query(
        `INSERT INTO public.abuse_signals (user_id, device_install_id, ip_hash, signal, severity, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          userId,
          meta.installId,
          meta.ipHash,
          finding.signal,
          finding.severity,
          JSON.stringify({ message: finding.message }),
        ],
      );
      if (finding.signal === AbuseSignal.IMPOSSIBLE_TRAVEL) {
        await this.addReputationEvent(userId, ReputationEventType.IMPLAUSIBLE_LOCATION, null);
      }
      if (finding.signal === AbuseSignal.SPAM_PATTERN && finding.severity === 'BLOCK') {
        await this.addReputationEvent(userId, ReputationEventType.SPAM_DETECTED, null);
      }
    }
  }

  // --- Lesen -----------------------------------------------------------------

  async byId(reportId: string, viewerId: string | null): Promise<Report | null> {
    const { rows } = await this.db.query<ReportRow>(`${REPORT_SELECT} WHERE r.id = $2`, [
      viewerId,
      reportId,
    ]);
    const row = rows[0];
    if (!row) return null;
    // Sichtbarkeitsregel serverseitig — nie im Client (§42).
    if (!isVisibleTo(row, viewerId)) return null;
    return toReport(row);
  }

  async list(query: ReportQuery, viewerId: string | null): Promise<Report[]> {
    const conditions: string[] = [
      `r.status = 'ACTIVE'`,
      'r.expires_at > now()',
    ];
    const params: Array<string | number | null> = [viewerId];

    if (query.tripId) {
      params.push(query.tripId);
      conditions.push(`r.trip_id = $${params.length}`);
      if (query.serviceDate) {
        params.push(query.serviceDate);
        conditions.push(`r.service_date = $${params.length}::date`);
      }
    }
    if (query.stopId) {
      params.push(query.stopId);
      conditions.push(`(r.stop_id = $${params.length} OR r.next_stop_id = $${params.length})`);
    }
    if (query.routeId) {
      params.push(query.routeId);
      conditions.push(`r.route_id = $${params.length}`);
    }
    if (query.lat !== undefined && query.lon !== undefined) {
      params.push(query.lat, query.lon, query.radiusMeters);
      conditions.push(
        `r.location IS NOT NULL AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length - 2}), 4326)::geography, $${params.length})`,
      );
    }

    params.push(query.limit);
    const sql = `${REPORT_SELECT} WHERE ${conditions.join(' AND ')}
       ORDER BY r.confidence DESC, r.created_at DESC
       LIMIT $${params.length}`;

    const { rows } = await this.db.query<ReportRow>(sql, params);
    return rows.filter((row) => isVisibleTo(row, viewerId)).map(toReport);
  }

  /** Eigene Meldungen — auch abgelaufene und moderierte (§23 Transparenz). */
  async listOwn(userId: string, limit: number): Promise<Report[]> {
    const { rows } = await this.db.query<ReportRow>(
      `${REPORT_SELECT} WHERE r.user_id = $2 ORDER BY r.created_at DESC LIMIT $3`,
      [userId, userId, limit],
    );
    return rows.map(toReport);
  }

  // --- Bestätigen / Widersprechen -------------------------------------------

  async vote(
    profile: ProfileRow,
    reportId: string,
    vote: 1 | -1,
  ): Promise<Report> {
    const rateLimits = await this.config.rateLimits();
    const recent = await this.db.queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.report_votes
       WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [profile.id],
    );
    const limited = checkRateLimit(
      { count: recent?.count ?? 0, limit: rateLimits.votesPerHour, windowLabel: 'pro Stunde' },
      AbuseSignal.RATE_LIMIT_VOTES,
      'Du hast sehr viele Meldungen bewertet. Bitte warte einen Moment.',
    );
    if (limited) {
      throw new AppError(ErrorCode.RATE_LIMITED, {
        message: limited.message,
        userMessage: { de: limited.userMessage },
      });
    }

    const report = await this.db.queryOne<{ id: string; user_id: string; status: ReportStatus }>(
      'SELECT id, user_id, status FROM public.reports WHERE id = $1',
      [reportId],
    );
    if (!report) throw new AppError(ErrorCode.NOT_FOUND);
    if (report.user_id === profile.id) {
      throw new AppError(ErrorCode.FORBIDDEN, {
        message: 'Eigene Meldung kann nicht bewertet werden',
        userMessage: {
          de: 'Du kannst deine eigene Meldung nicht bestätigen.',
          en: 'You cannot confirm your own report.',
        },
      });
    }

    // Eine Stimme pro Nutzer und Meldung (§18); erneutes Abstimmen ändert sie.
    await this.db.query(
      `INSERT INTO public.report_votes (report_id, user_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (report_id, user_id) DO UPDATE SET vote = EXCLUDED.vote`,
      [reportId, profile.id, vote],
    );

    await this.recomputeVotes(reportId);
    const updated = await this.recomputeTrust(reportId);

    await this.addReputationEvent(
      report.user_id,
      vote === 1 ? ReputationEventType.REPORT_CONFIRMED : ReputationEventType.REPORT_DISPUTED,
      reportId,
    );
    if (vote === 1) {
      await this.db.query(
        'UPDATE public.profiles SET confirmed_reports_count = confirmed_reports_count + 1 WHERE id = $1',
        [report.user_id],
      );
    }

    const result = await this.byId(reportId, profile.id);
    if (!result) throw new AppError(ErrorCode.NOT_FOUND);
    if (updated.expired) await this.realtime.broadcastReport(result, 'expired');
    else await this.realtime.broadcastReport(result, 'updated');
    return result;
  }

  private async recomputeVotes(reportId: string): Promise<void> {
    await this.db.query(
      `UPDATE public.reports r SET
         upvotes = v.up, downvotes = v.down
       FROM (
         SELECT
           count(*) FILTER (WHERE vote = 1)::int AS up,
           count(*) FILTER (WHERE vote = -1)::int AS down
         FROM public.report_votes WHERE report_id = $1
       ) v
       WHERE r.id = $1`,
      [reportId],
    );
  }

  /** Berechnet den Trust Score neu und beendet die Meldung ggf. vorzeitig. */
  async recomputeTrust(reportId: string): Promise<{ confidence: number; expired: boolean }> {
    const [trustConfig, moderationConfig] = await Promise.all([
      this.config.trust(),
      this.config.moderation(),
    ]);

    const row = await this.db.queryOne<{
      id: string;
      upvotes: number;
      downvotes: number;
      flags_count: number;
      created_at: Date;
      gps_plausibility: number;
      trip_session_id: string | null;
      status: ReportStatus;
      author_reputation: number;
      session_confidence: number | null;
      recent_by_author: number;
    }>(
      `SELECT r.id, r.upvotes, r.downvotes, r.flags_count, r.created_at, r.gps_plausibility,
              r.trip_session_id, r.status,
              p.reputation_score AS author_reputation,
              ts.confidence AS session_confidence,
              (SELECT count(*)::int FROM public.reports r2
                WHERE r2.user_id = r.user_id AND r2.created_at > now() - interval '1 hour') AS recent_by_author
       FROM public.reports r
       JOIN public.profiles p ON p.id = r.user_id
       LEFT JOIN public.trip_sessions ts ON ts.id = r.trip_session_id
       WHERE r.id = $1`,
      [reportId],
    );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);

    const confidence = computeTrustScore(
      {
        upvotes: row.upvotes,
        downvotes: row.downvotes,
        createdAt: row.created_at,
        authorReputation: row.author_reputation,
        hadTripSession: row.trip_session_id !== null,
        tripSessionConfidence: row.session_confidence,
        gpsPlausibility: Number(row.gps_plausibility),
        flagsCount: row.flags_count,
        recentReportsByAuthor: row.recent_by_author,
      },
      trustConfig,
    );

    const expired =
      row.status === 'ACTIVE' &&
      shouldAutoExpire({ upvotes: row.upvotes, downvotes: row.downvotes }, moderationConfig);

    await this.db.query(
      `UPDATE public.reports
       SET confidence = $2, status = CASE WHEN $3::boolean THEN 'EXPIRED'::public.report_status ELSE status END
       WHERE id = $1`,
      [reportId, confidence, expired],
    );

    return { confidence, expired };
  }

  // --- Missbrauch melden -----------------------------------------------------

  async flag(
    profile: ProfileRow,
    reportId: string,
    reason: string,
    note: string | undefined,
  ): Promise<{ queuedForModeration: boolean }> {
    const rateLimits = await this.config.rateLimits();
    const recent = await this.db.queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.report_flags
       WHERE user_id = $1 AND created_at > now() - interval '1 day'`,
      [profile.id],
    );
    const limited = checkRateLimit(
      { count: recent?.count ?? 0, limit: rateLimits.flagsPerDay, windowLabel: 'pro Tag' },
      AbuseSignal.RATE_LIMIT_REPORTS,
      'Du hast heute sehr viele Meldungen gemeldet.',
    );
    if (limited) {
      throw new AppError(ErrorCode.RATE_LIMITED, { message: limited.message });
    }

    const exists = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM public.reports WHERE id = $1',
      [reportId],
    );
    if (!exists) throw new AppError(ErrorCode.NOT_FOUND);

    await this.db.query(
      `INSERT INTO public.report_flags (report_id, user_id, reason, note)
       VALUES ($1, $2, $3::public.flag_reason, $4)
       ON CONFLICT (report_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note`,
      [reportId, profile.id, reason, note ?? null],
    );

    const counts = await this.db.queryOne<{ flags: number }>(
      `UPDATE public.reports r
       SET flags_count = (SELECT count(*)::int FROM public.report_flags WHERE report_id = $1)
       WHERE r.id = $1
       RETURNING flags_count AS flags`,
      [reportId],
    );

    const moderationConfig = await this.config.moderation();
    const queued = (counts?.flags ?? 0) >= moderationConfig.autoQueueFlagThreshold;
    if (queued) {
      await this.db.query(
        `UPDATE public.reports SET status = 'PENDING_REVIEW'
         WHERE id = $1 AND status = 'ACTIVE'`,
        [reportId],
      );
    }
    await this.recomputeTrust(reportId);
    return { queuedForModeration: queued };
  }

  // --- Ablauf ----------------------------------------------------------------

  /** Beendet abgelaufene Meldungen. Wird vom Worker regelmässig aufgerufen. */
  async expireDue(): Promise<number> {
    const result = await this.db.query(
      `UPDATE public.reports SET status = 'EXPIRED'
       WHERE status = 'ACTIVE' AND expires_at <= now()`,
    );
    return result.rowCount;
  }

  // --- Reputation ------------------------------------------------------------

  async addReputationEvent(
    userId: string,
    type: ReputationEventType,
    reportId: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const profile = await tx.query<{ reputation_score: number }>(
        'SELECT reputation_score FROM public.profiles WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const current = profile.rows[0]?.reputation_score ?? 0;
      const next = applyReputationEvent(current, type);
      const delta = next - current;
      await tx.query('UPDATE public.profiles SET reputation_score = $2 WHERE id = $1', [
        userId,
        next,
      ]);
      await tx.query(
        `INSERT INTO public.user_reputation_events (user_id, event_type, delta, report_id)
         VALUES ($1, $2, $3, $4)`,
        [userId, type, delta, reportId],
      );
    });
  }

  // --- Push ------------------------------------------------------------------

  /**
   * Legt Benachrichtigungen für Nutzer an, die dieser Fahrt folgen (§24/§25).
   * Der Versand selbst passiert im Worker; die Unique-Constraint der Tabelle
   * verhindert Mehrfachzustellung.
   */
  private async enqueueNotifications(
    report: Report,
    category: CategoryRow,
    authorId: string,
  ): Promise<void> {
    if (!report.tripId || !report.serviceDate) return;

    const settingsColumn = notificationColumnFor(category);
    const label = pickText(category.label);

    // Die Parametertypen müssen explizit gecastet werden: in einem
    // INSERT ... SELECT kann PostgreSQL sie nicht aus der Zielspalte ableiten.
    await this.db.query(
      `INSERT INTO public.notification_queue (user_id, report_id, notification_type, title, body, data)
       SELECT DISTINCT f.user_id, $1::uuid, $2::text, $3::text, $4::text, $5::jsonb
       FROM public.trip_follows f
       JOIN public.user_settings s ON s.user_id = f.user_id
       WHERE f.trip_id = $6 AND f.service_date = $7::date
         AND f.expires_at > now()
         AND f.user_id <> $8::uuid
         AND s.${settingsColumn}
       ON CONFLICT (user_id, report_id, notification_type) DO NOTHING`,
      [
        report.id,
        `report.${category.key}`,
        label,
        report.message ?? label,
        JSON.stringify({
          reportId: report.id,
          tripId: report.tripId,
          serviceDate: report.serviceDate,
          categoryKey: category.key,
        }),
        report.tripId,
        report.serviceDate,
        authorId,
      ],
    );
  }
}

// --- Hilfsstrukturen ---------------------------------------------------------

interface ReportContext {
  tripId: string | null;
  serviceDate: string | null;
  routeId: string | null;
  agencyId: string | null;
  directionId: number | null;
  vehicleType: VehicleType | null;
  stopId: string | null;
  nextStopId: string | null;
  tripSessionId: string | null;
  tripSessionConfidence: number | null;
  tripEndsAt: Date | null;
  distanceToRouteMeters: number | null;
}

interface SessionContextRow {
  id: string;
  trip_id: string;
  service_date: string;
  route_id: string | null;
  agency_id: string | null;
  vehicle_type: string | null;
  confidence: number;
}

interface AbuseCounters {
  lastHour: number;
  lastDay: number;
  last5Minutes: number;
  distinctContextsLast5Minutes: number;
  lastCreatedAt: Date | null;
  lastPosition: { lat: number; lon: number; at: Date } | null;
}

interface CategoryRow {
  id: string;
  key: string;
  label: LocalizedText;
  description: LocalizedText | null;
  icon: string;
  color: string;
  group: ReportCategory['group'];
  default_scope: ReportScope;
  allowed_scopes: ReportScope[];
  ttl_seconds: number;
  ttl_until_trip_end: boolean;
  requires_trip: boolean;
  requires_moderation: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  sort_order: number;
  active: boolean;
}

function toCategory(row: CategoryRow): ReportCategory {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    icon: row.icon,
    color: row.color,
    group: row.group,
    defaultScope: row.default_scope,
    allowedScopes: row.allowed_scopes,
    ttlSeconds: row.ttl_seconds,
    ttlUntilTripEnd: row.ttl_until_trip_end,
    requiresTrip: row.requires_trip,
    requiresModeration: row.requires_moderation,
    severity: row.severity,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

/**
 * Basisabfrage für Meldungen. `$1` ist die ID des Betrachters (oder NULL) und
 * wird für `my_vote`/`is_mine` verwendet.
 */
const REPORT_SELECT = `
  SELECT
    r.id, r.status, r.scope, r.agency_id, r.route_id, r.trip_id, r.service_date::text,
    r.direction_id, r.vehicle_type, r.stop_id, r.next_stop_id,
    ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lon,
    r.message, r.confidence, r.upvotes, r.downvotes, r.created_at, r.expires_at, r.user_id,
    c.key AS category_key, c.label AS category_label, c.icon AS category_icon,
    c.color AS category_color,
    p.alias AS author_alias,
    v.vote AS my_vote,
    (r.user_id = $1) AS is_mine,
    stop.name AS stop_name,
    nstop.name AS next_stop_name,
    rt.short_name AS route_short_name
  FROM public.reports r
  JOIN public.report_categories c ON c.id = r.category_id
  JOIN public.profiles p ON p.id = r.user_id
  LEFT JOIN public.report_votes v ON v.report_id = r.id AND v.user_id = $1
  LEFT JOIN transit.stops stop
    ON stop.feed_id = transit.active_feed_id() AND stop.stop_id = r.stop_id
  LEFT JOIN transit.stops nstop
    ON nstop.feed_id = transit.active_feed_id() AND nstop.stop_id = r.next_stop_id
  LEFT JOIN transit.routes rt
    ON rt.feed_id = transit.active_feed_id() AND rt.route_id = r.route_id
`;

interface ReportRow {
  id: string;
  status: ReportStatus;
  scope: ReportScope;
  agency_id: string | null;
  route_id: string | null;
  trip_id: string | null;
  service_date: string | null;
  direction_id: number | null;
  vehicle_type: VehicleType | null;
  stop_id: string | null;
  next_stop_id: string | null;
  lat: number | null;
  lon: number | null;
  message: string | null;
  confidence: number;
  upvotes: number;
  downvotes: number;
  created_at: Date;
  expires_at: Date;
  user_id: string;
  category_key: string;
  category_label: LocalizedText;
  category_icon: string;
  category_color: string;
  author_alias: string;
  my_vote: number | null;
  is_mine: boolean | null;
  stop_name: string | null;
  next_stop_name: string | null;
  route_short_name: string | null;
}

/**
 * Sichtbarkeit einer Meldung.
 *
 * Shadow-geflaggte Meldungen sieht ausschliesslich der Autor — und zwar so,
 * als wären sie normal veröffentlicht (§21).
 */
function isVisibleTo(row: ReportRow, viewerId: string | null): boolean {
  if (row.status === 'ACTIVE') return true;
  return viewerId !== null && row.user_id === viewerId;
}

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    source: 'COMMUNITY',
    categoryKey: row.category_key,
    categoryLabel: row.category_label,
    categoryIcon: row.category_icon,
    categoryColor: row.category_color,
    scope: row.scope,
    // Shadow-Status wird nach aussen als ACTIVE dargestellt.
    status: row.status === 'SHADOWED' ? 'ACTIVE' : row.status,
    agencyId: row.agency_id,
    routeId: row.route_id,
    routeShortName: row.route_short_name,
    tripId: row.trip_id,
    serviceDate: row.service_date,
    vehicleType: row.vehicle_type,
    directionId: row.direction_id,
    stopId: row.stop_id,
    stopName: row.stop_name,
    nextStopId: row.next_stop_id,
    nextStopName: row.next_stop_name,
    lat: row.lat,
    lon: row.lon,
    message: row.message,
    confidence: row.confidence,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    myVote: row.my_vote ?? null,
    isMine: row.is_mine ?? false,
    authorAlias: row.author_alias,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

function pickText(label: LocalizedText): string {
  return label.de;
}

/**
 * Ordnet eine Kategorie der passenden Benachrichtigungseinstellung zu (§24).
 * Der Rückgabewert ist ein fester Spaltenname aus einer geschlossenen Menge —
 * er stammt nie aus Nutzereingaben.
 */
function notificationColumnFor(category: CategoryRow): string {
  switch (category.group) {
    case 'CAPACITY':
      return 'notify_high_occupancy';
    case 'VEHICLE':
      return 'notify_vehicle_issues';
    case 'SAFETY':
      return 'notify_safety';
    case 'DISRUPTION':
      return category.key === 'connection_at_risk' ? 'notify_connection_at_risk' : 'notify_delays';
    default:
      return 'notify_community_reports';
  }
}
