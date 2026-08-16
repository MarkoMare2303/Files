import type { Database } from '@swissov/database';
import { AppError, ErrorCode, ReputationEventType } from '@swissov/shared';
import type {
  AdminReport,
  AdminReportFilter,
  AdminUser,
  ModerateReportInput,
  ModerateUserInput,
  ModerationAction,
} from '@swissov/types';
import type { ReportsService } from './reports.service.js';

/**
 * Moderation (§32/§33).
 *
 * Jede Aktion wird protokolliert (`moderation_actions`) und zusätzlich im
 * Audit-Log (`admin_audit_logs`) festgehalten. Beides ist append-only.
 */
export interface AuditContext {
  actorId: string;
  actorAlias: string;
  ip: string | null;
  userAgent: string | null;
}

export class ModerationService {
  constructor(
    private readonly db: Database,
    private readonly reports: ReportsService,
  ) {}

  async listReports(filter: AdminReportFilter): Promise<{ items: AdminReport[]; total: number }> {
    const conditions: string[] = ['TRUE'];
    const params: Array<string | number | boolean | null> = [];

    const push = (value: string | number | boolean | null): number => {
      params.push(value);
      return params.length;
    };

    if (filter.from) conditions.push(`r.created_at >= $${push(filter.from)}::timestamptz`);
    if (filter.to) conditions.push(`r.created_at <= $${push(filter.to)}::timestamptz`);
    if (filter.categoryKey) conditions.push(`c.key = $${push(filter.categoryKey)}`);
    if (filter.agencyId) conditions.push(`r.agency_id = $${push(filter.agencyId)}`);
    if (filter.routeId) conditions.push(`r.route_id = $${push(filter.routeId)}`);
    if (filter.userId) conditions.push(`r.user_id = $${push(filter.userId)}::uuid`);
    if (filter.status) conditions.push(`r.status = $${push(filter.status)}::public.report_status`);
    if (filter.scope) conditions.push(`r.scope = $${push(filter.scope)}::public.report_scope`);
    if (filter.minConfidence !== undefined) {
      conditions.push(`r.confidence >= $${push(filter.minConfidence)}`);
    }
    if (filter.maxConfidence !== undefined) {
      conditions.push(`r.confidence <= $${push(filter.maxConfidence)}`);
    }
    if (filter.flaggedOnly) conditions.push('r.flags_count > 0');
    if (filter.q) {
      // ILIKE mit parametrisiertem Muster — keine String-Konkatenation von SQL.
      conditions.push(`(r.message ILIKE $${push(`%${filter.q}%`)} OR r.trip_id ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countRow = await this.db.queryOne<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM public.reports r
       JOIN public.report_categories c ON c.id = r.category_id
       WHERE ${where}`,
      params,
    );

    const limitIndex = push(filter.limit);
    const offsetIndex = push(filter.offset);

    const { rows } = await this.db.query<AdminReportRow>(
      `SELECT r.id, c.key AS category_key, r.scope, r.status, r.confidence,
              r.upvotes, r.downvotes, r.flags_count, r.message,
              r.agency_id, r.route_id, rt.short_name AS route_short_name,
              r.trip_id, r.stop_id, s.name AS stop_name,
              ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lon,
              r.user_id, p.alias AS user_alias, p.status AS user_status,
              p.reputation_score AS user_reputation,
              r.created_at, r.expires_at
       FROM public.reports r
       JOIN public.report_categories c ON c.id = r.category_id
       JOIN public.profiles p ON p.id = r.user_id
       LEFT JOIN transit.stops s
         ON s.feed_id = transit.active_feed_id() AND s.stop_id = r.stop_id
       LEFT JOIN transit.routes rt
         ON rt.feed_id = transit.active_feed_id() AND rt.route_id = r.route_id
       WHERE ${where}
       ORDER BY r.flags_count DESC, r.created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    );

    return {
      total: countRow?.total ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        categoryKey: row.category_key,
        scope: row.scope,
        status: row.status,
        confidence: row.confidence,
        upvotes: row.upvotes,
        downvotes: row.downvotes,
        flagsCount: row.flags_count,
        message: row.message,
        agencyId: row.agency_id,
        routeId: row.route_id,
        routeShortName: row.route_short_name,
        tripId: row.trip_id,
        stopId: row.stop_id,
        stopName: row.stop_name,
        lat: row.lat,
        lon: row.lon,
        userId: row.user_id,
        userAlias: row.user_alias,
        userStatus: row.user_status,
        userReputation: row.user_reputation,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      })),
    };
  }

  async moderateReport(
    reportId: string,
    input: ModerateReportInput,
    context: AuditContext,
  ): Promise<AdminReport> {
    const before = await this.db.queryOne<{ status: string; user_id: string }>(
      'SELECT status, user_id FROM public.reports WHERE id = $1',
      [reportId],
    );
    if (!before) throw new AppError(ErrorCode.NOT_FOUND);

    const nextStatus =
      input.action === 'REMOVE' ? 'REMOVED' : input.action === 'RESTORE' ? 'ACTIVE' : 'ACTIVE';

    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE public.reports SET
           status = $2::public.report_status,
           removed_at = CASE WHEN $2 = 'REMOVED' THEN now() ELSE NULL END,
           removed_by = CASE WHEN $2 = 'REMOVED' THEN $3::uuid ELSE NULL END,
           removal_reason = CASE WHEN $2 = 'REMOVED' THEN $4 ELSE NULL END
         WHERE id = $1`,
        [reportId, nextStatus, context.actorId, input.reason],
      );

      await tx.query(
        `INSERT INTO public.moderation_actions (moderator_id, action, target_report_id, reason)
         VALUES ($1, $2::public.moderation_action_type, $3, $4)`,
        [
          context.actorId,
          input.action === 'REMOVE'
            ? 'REPORT_REMOVED'
            : input.action === 'RESTORE'
              ? 'REPORT_RESTORED'
              : 'REPORT_APPROVED',
          reportId,
          input.reason,
        ],
      );

      // Offene Missbrauchsmeldungen als erledigt markieren.
      await tx.query(
        `UPDATE public.report_flags SET resolved_at = now(), resolved_by = $2
         WHERE report_id = $1 AND resolved_at IS NULL`,
        [reportId, context.actorId],
      );

      if (input.action === 'REMOVE') {
        await tx.query(
          'UPDATE public.profiles SET removed_reports_count = removed_reports_count + 1 WHERE id = $1',
          [before.user_id],
        );
      }
    });

    if (input.action === 'REMOVE') {
      await this.reports.addReputationEvent(
        before.user_id,
        ReputationEventType.REPORT_REMOVED_BY_MODERATION,
        reportId,
      );
    }

    await this.audit(context, {
      action: `report.${input.action.toLowerCase()}`,
      entityType: 'report',
      entityId: reportId,
      before: { status: before.status },
      after: { status: nextStatus, reason: input.reason },
    });

    const updated = await this.db.queryOne<AdminReportRow>(
      `SELECT r.id, c.key AS category_key, r.scope, r.status, r.confidence, r.upvotes, r.downvotes,
              r.flags_count, r.message, r.agency_id, r.route_id, NULL::text AS route_short_name,
              r.trip_id, r.stop_id, NULL::text AS stop_name,
              ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lon,
              r.user_id, p.alias AS user_alias, p.status AS user_status,
              p.reputation_score AS user_reputation, r.created_at, r.expires_at
       FROM public.reports r
       JOIN public.report_categories c ON c.id = r.category_id
       JOIN public.profiles p ON p.id = r.user_id
       WHERE r.id = $1`,
      [reportId],
    );
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND);

    return {
      id: updated.id,
      categoryKey: updated.category_key,
      scope: updated.scope,
      status: updated.status,
      confidence: updated.confidence,
      upvotes: updated.upvotes,
      downvotes: updated.downvotes,
      flagsCount: updated.flags_count,
      message: updated.message,
      agencyId: updated.agency_id,
      routeId: updated.route_id,
      routeShortName: updated.route_short_name,
      tripId: updated.trip_id,
      stopId: updated.stop_id,
      stopName: updated.stop_name,
      lat: updated.lat,
      lon: updated.lon,
      userId: updated.user_id,
      userAlias: updated.user_alias,
      userStatus: updated.user_status,
      userReputation: updated.user_reputation,
      createdAt: updated.created_at.toISOString(),
      expiresAt: updated.expires_at.toISOString(),
    };
  }

  async listUsers(filter: {
    q?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminUser[]; total: number }> {
    const params: Array<string | number> = [];
    const conditions: string[] = ['TRUE'];
    if (filter.q) {
      params.push(`%${filter.q}%`);
      conditions.push(`p.alias ILIKE $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`p.status = $${params.length}::public.account_status`);
    }
    const where = conditions.join(' AND ');

    const totalRow = await this.db.queryOne<{ total: number }>(
      `SELECT count(*)::int AS total FROM public.profiles p WHERE ${where}`,
      params,
    );

    params.push(filter.limit, filter.offset);
    const { rows } = await this.db.query<AdminUserRow>(
      `SELECT p.id, p.alias, p.role, p.status, p.reputation_score, p.reports_count,
              p.removed_reports_count, p.created_at, p.last_active_at,
              (SELECT count(*)::int FROM public.report_flags f
                 JOIN public.reports r ON r.id = f.report_id
                WHERE r.user_id = p.id) AS flags_received
       FROM public.profiles p
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      total: totalRow?.total ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        alias: row.alias,
        role: row.role,
        status: row.status,
        reputationScore: row.reputation_score,
        reportsCount: row.reports_count,
        removedReportsCount: row.removed_reports_count,
        flagsReceived: row.flags_received,
        createdAt: row.created_at.toISOString(),
        lastActiveAt: row.last_active_at?.toISOString() ?? null,
      })),
    };
  }

  async moderateUser(
    userId: string,
    input: ModerateUserInput,
    context: AuditContext,
  ): Promise<AdminUser> {
    const before = await this.db.queryOne<{ status: string; role: string }>(
      'SELECT status, role FROM public.profiles WHERE id = $1',
      [userId],
    );
    if (!before) throw new AppError(ErrorCode.NOT_FOUND);
    if (before.role === 'ADMIN' && input.action !== 'WARN') {
      throw new AppError(ErrorCode.FORBIDDEN, {
        message: 'Administratorkonten können nicht über die Moderation gesperrt werden',
      });
    }

    const statusByAction: Record<ModerateUserInput['action'], string | null> = {
      WARN: null,
      SHADOW_FLAG: 'SHADOW_FLAGGED',
      SUSPEND: 'SUSPENDED',
      REINSTATE: 'ACTIVE',
    };
    const nextStatus = statusByAction[input.action];
    const suspendedUntil =
      input.action === 'SUSPEND' && input.durationHours
        ? new Date(Date.now() + input.durationHours * 3_600_000)
        : null;

    await this.db.transaction(async (tx) => {
      if (nextStatus) {
        await tx.query(
          `UPDATE public.profiles
           SET status = $2::public.account_status,
               suspended_until = CASE WHEN $2 = 'SUSPENDED' THEN $3::timestamptz ELSE NULL END
           WHERE id = $1`,
          [userId, nextStatus, suspendedUntil],
        );
      }
      await tx.query(
        `INSERT INTO public.moderation_actions (moderator_id, action, target_user_id, reason)
         VALUES ($1, $2::public.moderation_action_type, $3, $4)`,
        [
          context.actorId,
          input.action === 'WARN'
            ? 'USER_WARNED'
            : input.action === 'SHADOW_FLAG'
              ? 'USER_SHADOW_FLAGGED'
              : input.action === 'SUSPEND'
                ? 'USER_SUSPENDED'
                : 'USER_REINSTATED',
          userId,
          input.reason,
        ],
      );
    });

    await this.audit(context, {
      action: `user.${input.action.toLowerCase()}`,
      entityType: 'profile',
      entityId: userId,
      before: { status: before.status },
      after: { status: nextStatus ?? before.status, reason: input.reason },
    });

    const { items } = await this.listUsersById(userId);
    return items[0]!;
  }

  private async listUsersById(userId: string): Promise<{ items: AdminUser[] }> {
    const { rows } = await this.db.query<AdminUserRow>(
      `SELECT p.id, p.alias, p.role, p.status, p.reputation_score, p.reports_count,
              p.removed_reports_count, p.created_at, p.last_active_at,
              (SELECT count(*)::int FROM public.report_flags f
                 JOIN public.reports r ON r.id = f.report_id
                WHERE r.user_id = p.id) AS flags_received
       FROM public.profiles p WHERE p.id = $1`,
      [userId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        alias: row.alias,
        role: row.role,
        status: row.status,
        reputationScore: row.reputation_score,
        reportsCount: row.reports_count,
        removedReportsCount: row.removed_reports_count,
        flagsReceived: row.flags_received,
        createdAt: row.created_at.toISOString(),
        lastActiveAt: row.last_active_at?.toISOString() ?? null,
      })),
    };
  }

  async userHistory(userId: string): Promise<ModerationAction[]> {
    const { rows } = await this.db.query<{
      id: string;
      action: ModerationAction['action'];
      reason: string;
      moderator_alias: string;
      target_report_id: string | null;
      target_user_id: string | null;
      created_at: Date;
    }>(
      `SELECT m.id, m.action, m.reason, p.alias AS moderator_alias,
              m.target_report_id, m.target_user_id, m.created_at
       FROM public.moderation_actions m
       JOIN public.profiles p ON p.id = m.moderator_id
       WHERE m.target_user_id = $1
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason,
      moderatorAlias: row.moderator_alias,
      targetReportId: row.target_report_id,
      targetUserId: row.target_user_id,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /** Schreibt einen Audit-Eintrag (§33). */
  async audit(
    context: AuditContext,
    entry: {
      action: string;
      entityType: string;
      entityId: string | null;
      before?: unknown;
      after?: unknown;
    },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO public.admin_audit_logs
         (actor_id, actor_alias, action, entity_type, entity_id, before, after, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9)`,
      [
        context.actorId,
        context.actorAlias,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        context.ip,
        context.userAgent?.slice(0, 500) ?? null,
      ],
    );
  }
}

interface AdminReportRow {
  id: string;
  category_key: string;
  scope: AdminReport['scope'];
  status: AdminReport['status'];
  confidence: number;
  upvotes: number;
  downvotes: number;
  flags_count: number;
  message: string | null;
  agency_id: string | null;
  route_id: string | null;
  route_short_name: string | null;
  trip_id: string | null;
  stop_id: string | null;
  stop_name: string | null;
  lat: number | null;
  lon: number | null;
  user_id: string;
  user_alias: string;
  user_status: AdminUser['status'];
  user_reputation: number;
  created_at: Date;
  expires_at: Date;
}

interface AdminUserRow {
  id: string;
  alias: string;
  role: AdminUser['role'];
  status: AdminUser['status'];
  reputation_score: number;
  reports_count: number;
  removed_reports_count: number;
  flags_received: number;
  created_at: Date;
  last_active_at: Date | null;
}
