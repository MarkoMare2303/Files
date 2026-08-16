import { AppError, ErrorCode } from '@swissov/shared';
import {
  adminDashboardSchema,
  adminReportFilterSchema,
  adminReportSchema,
  adminUserSchema,
  auditLogSchema,
  featureFlagSchema,
  moderateReportInputSchema,
  moderateUserInputSchema,
  moderationActionSchema,
  reportCategorySchema,
  runtimeConfigSchema,
  upsertCategoryInputSchema,
  uuidSchema,
} from '@swissov/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { AuditContext } from '../services/moderation.service.js';
import type { ApiServices } from '../services/index.js';

/**
 * Admin-API (§32/§33).
 *
 * Autorisierung erfolgt ausschliesslich serverseitig über die Rolle im Profil —
 * nie über Angaben aus dem Client. Jede verändernde Aktion landet im Audit-Log.
 */
export const adminRoutes =
  (ctx: AppContext, services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    // Moderator-Rechte als Basis; einzelne Routen verschärfen auf ADMIN.
    fastify.addHook('onRequest', fastify.requireModerator);

    const auditContext = (request: {
      user: { id: string; profile: { alias: string } } | null;
      ip: string;
      headers: Record<string, unknown>;
    }): AuditContext => ({
      actorId: request.user!.id,
      actorAlias: request.user!.profile.alias,
      ip: request.ip,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });

    // --- Dashboard ------------------------------------------------------------

    fastify.get(
      '/dashboard',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Kennzahlen-Übersicht',
          security: [{ bearerAuth: [] }],
          response: { 200: adminDashboardSchema },
        },
      },
      async () => {
        const [users, reports, byCategory, transitStats, feedHealth] = await Promise.all([
          ctx.db.queryOne<{
            total: number;
            active_7d: number;
            new_7d: number;
            suspended: number;
            shadow_flagged: number;
          }>(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE last_active_at > now() - interval '7 days')::int AS active_7d,
                    count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_7d,
                    count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
                    count(*) FILTER (WHERE status = 'SHADOW_FLAGGED')::int AS shadow_flagged
             FROM public.profiles WHERE deleted_at IS NULL`,
          ),
          ctx.db.queryOne<{
            today: number;
            active: number;
            last_7d: number;
            pending: number;
            removed_7d: number;
          }>(
            `SELECT
               count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Zurich'))::int AS today,
               count(*) FILTER (WHERE status = 'ACTIVE' AND expires_at > now())::int AS active,
               count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last_7d,
               count(*) FILTER (WHERE status = 'PENDING_REVIEW')::int AS pending,
               count(*) FILTER (WHERE status = 'REMOVED' AND removed_at > now() - interval '7 days')::int AS removed_7d
             FROM public.reports`,
          ),
          ctx.db.query<{ key: string; label: Record<string, string>; count: number }>(
            `SELECT c.key, c.label, count(r.id)::int AS count
             FROM public.report_categories c
             LEFT JOIN public.reports r
               ON r.category_id = c.id AND r.created_at > now() - interval '7 days'
             GROUP BY c.key, c.label, c.sort_order
             ORDER BY count DESC, c.sort_order
             LIMIT 30`,
          ),
          ctx.db.queryOne<{
            id: string | null;
            feed_version: string | null;
            status: string | null;
            activated_at: Date | null;
            stats: Record<string, number> | null;
          }>(
            `SELECT id, feed_version, status::text, activated_at, stats
             FROM transit.gtfs_imports WHERE status = 'ACTIVE' LIMIT 1`,
          ),
          ctx.db.query<{
            component: string;
            last_success_at: Date | null;
            last_error: string | null;
            consecutive_failures: number;
          }>(
            'SELECT component, last_success_at, last_error, consecutive_failures FROM transit.feed_health',
          ),
        ]);

        const lastImport = await ctx.db.queryOne<{ status: string; error: string | null }>(
          `SELECT status::text, error FROM transit.gtfs_imports ORDER BY started_at DESC LIMIT 1`,
        );

        const totalRecent = reports?.last_7d ?? 0;
        const spamRate =
          totalRecent > 0 ? Math.round(((reports?.removed_7d ?? 0) / totalRecent) * 1000) / 10 : 0;

        return {
          users: {
            total: users?.total ?? 0,
            activeLast7Days: users?.active_7d ?? 0,
            newLast7Days: users?.new_7d ?? 0,
            suspended: users?.suspended ?? 0,
            shadowFlagged: users?.shadow_flagged ?? 0,
          },
          reports: {
            today: reports?.today ?? 0,
            active: reports?.active ?? 0,
            last7Days: totalRecent,
            pendingModeration: reports?.pending ?? 0,
            removedLast7Days: reports?.removed_7d ?? 0,
            spamRatePercent: spamRate,
            byCategory: byCategory.rows.map((row) => ({
              categoryKey: row.key,
              label: row.label as { de: string },
              count: row.count,
            })),
          },
          transit: {
            activeImport: transitStats?.id
              ? {
                  id: transitStats.id,
                  feedVersion: transitStats.feed_version,
                  status: (transitStats.status ?? 'ACTIVE') as 'ACTIVE',
                  activatedAt: transitStats.activated_at?.toISOString() ?? null,
                  stops: transitStats.stats?.['stops.txt'] ?? 0,
                  routes: transitStats.stats?.['routes.txt'] ?? 0,
                  trips: transitStats.stats?.['trips.txt'] ?? 0,
                  stopTimes: transitStats.stats?.['stop_times.txt'] ?? 0,
                }
              : null,
            lastImportStatus: (lastImport?.status ?? null) as 'ACTIVE' | null,
            lastImportError: lastImport?.error ?? null,
          },
          health: feedHealth.rows.map((row) => ({
            component: row.component,
            status:
              row.consecutive_failures === 0
                ? ('OK' as const)
                : row.consecutive_failures < 5
                  ? ('DEGRADED' as const)
                  : ('DOWN' as const),
            lastSuccessAt: row.last_success_at?.toISOString() ?? null,
            message: row.last_error,
          })),
        };
      },
    );

    // --- Meldungen ------------------------------------------------------------

    fastify.get(
      '/reports',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Meldungen filtern',
          security: [{ bearerAuth: [] }],
          querystring: adminReportFilterSchema,
          response: { 200: z.object({ items: z.array(adminReportSchema), total: z.number() }) },
        },
      },
      async (request) => services.moderation.listReports(request.query),
    );

    fastify.post(
      '/reports/:reportId/moderate',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Meldung moderieren',
          description: 'Bestätigen, entfernen oder wiederherstellen. Wird im Audit-Log protokolliert.',
          security: [{ bearerAuth: [] }],
          params: z.object({ reportId: uuidSchema }),
          body: moderateReportInputSchema,
          response: { 200: z.object({ report: adminReportSchema }) },
        },
      },
      async (request) => ({
        report: await services.moderation.moderateReport(
          request.params.reportId,
          request.body,
          auditContext(request),
        ),
      }),
    );

    // --- Nutzer ---------------------------------------------------------------

    fastify.get(
      '/users',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Nutzer suchen',
          security: [{ bearerAuth: [] }],
          querystring: z.object({
            q: z.string().max(120).optional(),
            status: z.enum(['ACTIVE', 'SHADOW_FLAGGED', 'SUSPENDED', 'DELETED']).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          }),
          response: { 200: z.object({ items: z.array(adminUserSchema), total: z.number() }) },
        },
      },
      async (request) => services.moderation.listUsers(request.query),
    );

    fastify.post(
      '/users/:userId/moderate',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Nutzer moderieren',
          security: [{ bearerAuth: [] }],
          params: z.object({ userId: uuidSchema }),
          body: moderateUserInputSchema,
          response: { 200: z.object({ user: adminUserSchema }) },
        },
      },
      async (request) => ({
        user: await services.moderation.moderateUser(
          request.params.userId,
          request.body,
          auditContext(request),
        ),
      }),
    );

    fastify.get(
      '/users/:userId/history',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Moderationshistorie eines Nutzers',
          security: [{ bearerAuth: [] }],
          params: z.object({ userId: uuidSchema }),
          response: { 200: z.object({ actions: z.array(moderationActionSchema) }) },
        },
      },
      async (request) => ({ actions: await services.moderation.userHistory(request.params.userId) }),
    );

    // --- Kategorien (§32) -----------------------------------------------------

    fastify.get(
      '/categories',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Alle Kategorien inkl. deaktivierter',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ categories: z.array(reportCategorySchema) }) },
        },
      },
      async () => ({ categories: await services.reports.categories(true) }),
    );

    fastify.put(
      '/categories/:key',
      {
        onRequest: [fastify.requireAdmin],
        schema: {
          tags: ['Admin'],
          summary: 'Kategorie anlegen oder ändern',
          description:
            'Legt eine Kategorie an oder aktualisiert sie. Der Schlüssel ist unveränderlich; ' +
            'TTL, Icon, Farbe, Scopes und Moderationspflicht sind frei konfigurierbar (§17/§32).',
          security: [{ bearerAuth: [] }],
          params: z.object({ key: z.string().min(2).max(64) }),
          body: upsertCategoryInputSchema,
          response: { 200: z.object({ category: reportCategorySchema }) },
        },
      },
      async (request) => {
        if (request.params.key !== request.body.key) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, {
            message: 'Der Schlüssel im Pfad und im Body muss übereinstimmen',
          });
        }
        const body = request.body;
        const before = await ctx.db.queryOne('SELECT * FROM public.report_categories WHERE key = $1', [
          body.key,
        ]);

        await ctx.db.query(
          `INSERT INTO public.report_categories (
             key, label, description, icon, color, "group", default_scope, allowed_scopes,
             ttl_seconds, ttl_until_trip_end, requires_trip, requires_moderation, severity,
             sort_order, active
           )
           VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6::public.category_group,
                   $7::public.report_scope, $8::public.report_scope[], $9, $10, $11, $12,
                   $13::public.category_severity, $14, $15)
           ON CONFLICT (key) DO UPDATE SET
             label = EXCLUDED.label, description = EXCLUDED.description, icon = EXCLUDED.icon,
             color = EXCLUDED.color, "group" = EXCLUDED."group",
             default_scope = EXCLUDED.default_scope, allowed_scopes = EXCLUDED.allowed_scopes,
             ttl_seconds = EXCLUDED.ttl_seconds, ttl_until_trip_end = EXCLUDED.ttl_until_trip_end,
             requires_trip = EXCLUDED.requires_trip,
             requires_moderation = EXCLUDED.requires_moderation,
             severity = EXCLUDED.severity, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active`,
          [
            body.key,
            JSON.stringify(body.label),
            body.description ? JSON.stringify(body.description) : null,
            body.icon,
            body.color,
            body.group,
            body.defaultScope,
            `{${body.allowedScopes.join(',')}}`,
            body.ttlSeconds,
            body.ttlUntilTripEnd,
            body.requiresTrip,
            body.requiresModeration,
            body.severity,
            body.sortOrder,
            body.active,
          ],
        );
        await services.reports.invalidateCategories();
        await services.moderation.audit(auditContext(request), {
          action: before ? 'category.update' : 'category.create',
          entityType: 'report_category',
          entityId: body.key,
          before,
          after: body,
        });

        const categories = await services.reports.categories(true);
        const category = categories.find((c) => c.key === body.key);
        if (!category) throw new AppError(ErrorCode.INTERNAL);
        return { category };
      },
    );

    // --- Laufzeitkonfiguration -------------------------------------------------

    fastify.get(
      '/config',
      {
        onRequest: [fastify.requireAdmin],
        schema: {
          tags: ['Admin'],
          summary: 'Laufzeitkonfiguration lesen',
          security: [{ bearerAuth: [] }],
          response: { 200: runtimeConfigSchema },
        },
      },
      async () => ctx.config.all(),
    );

    fastify.put(
      '/config/:section',
      {
        onRequest: [fastify.requireAdmin],
        schema: {
          tags: ['Admin'],
          summary: 'Konfigurationsabschnitt ändern',
          description:
            'Ändert Confidence-Schwellen, Rate Limits, Moderationsregeln oder Trust-Gewichte. ' +
            'Die Werte werden serverseitig gegen das Schema validiert.',
          security: [{ bearerAuth: [] }],
          params: z.object({ section: z.enum(['detection', 'rateLimits', 'moderation', 'trust']) }),
          body: z.record(z.unknown()),
          response: { 200: runtimeConfigSchema },
        },
      },
      async (request) => {
        const { previous, next } = await ctx.config.update(
          request.params.section,
          request.body,
          request.user!.id,
        );
        await services.moderation.audit(auditContext(request), {
          action: 'config.update',
          entityType: 'app_config',
          entityId: request.params.section,
          before: previous,
          after: next,
        });
        return ctx.config.all();
      },
    );

    // --- Feature-Flags ---------------------------------------------------------

    fastify.get(
      '/feature-flags',
      {
        schema: {
          tags: ['Admin'],
          summary: 'Feature-Flags',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ flags: z.array(featureFlagSchema) }) },
        },
      },
      async () => {
        const flags = await ctx.flags.all();
        return {
          flags: flags.map((flag) => ({
            key: flag.key,
            enabled: flag.enabled,
            description: flag.description,
            rolloutPercentage: flag.rollout_percentage,
            updatedAt: flag.updated_at.toISOString(),
          })),
        };
      },
    );

    fastify.patch(
      '/feature-flags/:key',
      {
        onRequest: [fastify.requireAdmin],
        schema: {
          tags: ['Admin'],
          summary: 'Feature-Flag ändern',
          security: [{ bearerAuth: [] }],
          params: z.object({ key: z.string().min(2).max(64) }),
          body: z.object({
            enabled: z.boolean().optional(),
            rolloutPercentage: z.number().int().min(0).max(100).optional(),
            description: z.string().max(500).nullable().optional(),
          }),
          response: { 200: z.object({ flag: featureFlagSchema }) },
        },
      },
      async (request) => {
        const before = (await ctx.flags.all()).find((f) => f.key === request.params.key);
        const updated = await ctx.flags.set(request.params.key, request.body, request.user!.id);
        await services.moderation.audit(auditContext(request), {
          action: 'feature_flag.update',
          entityType: 'feature_flag',
          entityId: request.params.key,
          before,
          after: updated,
        });
        return {
          flag: {
            key: updated.key,
            enabled: updated.enabled,
            description: updated.description,
            rolloutPercentage: updated.rollout_percentage,
            updatedAt: updated.updated_at.toISOString(),
          },
        };
      },
    );

    // --- Audit-Log -------------------------------------------------------------

    fastify.get(
      '/audit-logs',
      {
        onRequest: [fastify.requireAdmin],
        schema: {
          tags: ['Admin'],
          summary: 'Audit-Log',
          description: 'Append-only Protokoll aller administrativen Änderungen (§33).',
          security: [{ bearerAuth: [] }],
          querystring: z.object({
            entityType: z.string().max(64).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(100),
            offset: z.coerce.number().int().min(0).default(0),
          }),
          response: { 200: z.object({ items: z.array(auditLogSchema), total: z.number() }) },
        },
      },
      async (request) => {
        const { entityType, limit, offset } = request.query;
        const total = await ctx.db.queryOne<{ total: number }>(
          `SELECT count(*)::int AS total FROM public.admin_audit_logs
           WHERE $1::text IS NULL OR entity_type = $1`,
          [entityType ?? null],
        );
        const { rows } = await ctx.db.query<{
          id: string;
          actor_id: string | null;
          actor_alias: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          before: unknown;
          after: unknown;
          ip: string | null;
          created_at: Date;
        }>(
          `SELECT id, actor_id, actor_alias, action, entity_type, entity_id, before, after,
                  host(ip) AS ip, created_at
           FROM public.admin_audit_logs
           WHERE $1::text IS NULL OR entity_type = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [entityType ?? null, limit, offset],
        );
        return {
          total: total?.total ?? 0,
          items: rows.map((row) => ({
            id: row.id,
            actorId: row.actor_id,
            actorAlias: row.actor_alias,
            action: row.action,
            entityType: row.entity_type,
            entityId: row.entity_id,
            before: row.before ?? null,
            after: row.after ?? null,
            ip: row.ip,
            createdAt: row.created_at.toISOString(),
          })),
        };
      },
    );
  };
