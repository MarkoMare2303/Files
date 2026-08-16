import { AppError, ErrorCode } from '@swissov/shared';
import {
  createFavoriteSchema,
  favoriteSchema,
  profileSchema,
  registerDeviceSchema,
  reportSchema,
  updateUserSettingsSchema,
  userSettingsSchema,
  uuidSchema,
} from '@swissov/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { ApiServices } from '../services/index.js';

/**
 * Konto, Einstellungen, Favoriten, Geräte, Datenexport und Löschung (§23/§26).
 */
export const meRoutes =
  (ctx: AppContext, services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    fastify.addHook('onRequest', fastify.requireAuth);

    fastify.get(
      '/me',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Eigenes Profil',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ profile: profileSchema, settings: userSettingsSchema }) },
        },
      },
      async (request) => ({
        profile: ctx.profiles.toProfile(request.user!.profile),
        settings: await ctx.profiles.getSettings(request.user!.id),
      }),
    );

    fastify.patch(
      '/me/settings',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Einstellungen ändern',
          description:
            'Einwilligungen (Hintergrundstandort, Analytik) werden mit Zeitstempel protokolliert ' +
            'und sind jederzeit widerrufbar (§23).',
          security: [{ bearerAuth: [] }],
          body: updateUserSettingsSchema,
          response: { 200: z.object({ settings: userSettingsSchema }) },
        },
      },
      async (request) => ({
        settings: await ctx.profiles.updateSettings(request.user!.id, request.body),
      }),
    );

    fastify.get(
      '/me/reports',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Eigene Meldungen',
          description: 'Enthält auch abgelaufene und moderierte Meldungen — volle Transparenz.',
          security: [{ bearerAuth: [] }],
          querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
          response: { 200: z.object({ reports: z.array(reportSchema) }) },
        },
      },
      async (request) => ({
        reports: await services.reports.listOwn(request.user!.id, request.query.limit),
      }),
    );

    // --- Favoriten (§26) ------------------------------------------------------

    fastify.get(
      '/me/favorites',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Favoriten',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ favorites: z.array(favoriteSchema) }) },
        },
      },
      async (request) => ({ favorites: await listFavorites(ctx, request.user!.id) }),
    );

    fastify.post(
      '/me/favorites',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Favorit anlegen',
          security: [{ bearerAuth: [] }],
          body: createFavoriteSchema,
          response: { 201: z.object({ favorite: favoriteSchema }) },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const row = await ctx.db.queryOne<FavoriteRow>(
          `INSERT INTO public.favorites (user_id, kind, label, stop_id, route_id, origin_stop_id, destination_stop_id, sort_order)
           VALUES ($1, $2::public.favorite_kind, $3, $4, $5, $6, $7,
                   COALESCE((SELECT max(sort_order) + 1 FROM public.favorites WHERE user_id = $1), 0))
           ON CONFLICT DO NOTHING
           RETURNING id, kind, label, stop_id, route_id, origin_stop_id, destination_stop_id, sort_order, created_at`,
          [
            request.user!.id,
            body.kind,
            body.label,
            body.stopId ?? null,
            body.routeId ?? null,
            body.originStopId ?? null,
            body.destinationStopId ?? null,
          ],
        );
        if (!row) {
          throw new AppError(ErrorCode.CONFLICT, {
            message: 'Favorit existiert bereits',
            userMessage: {
              de: 'Das ist bereits in deinen Favoriten.',
              en: 'This is already in your favourites.',
            },
          });
        }
        return reply.status(201).send({ favorite: toFavorite(row) });
      },
    );

    fastify.delete(
      '/me/favorites/:favoriteId',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Favorit entfernen',
          security: [{ bearerAuth: [] }],
          params: z.object({ favoriteId: uuidSchema }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await ctx.db.query('DELETE FROM public.favorites WHERE id = $1 AND user_id = $2', [
          request.params.favoriteId,
          request.user!.id,
        ]);
        return reply.status(204).send(null);
      },
    );

    // --- Geräte und Push ------------------------------------------------------

    fastify.post(
      '/me/devices',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Gerät registrieren',
          description:
            'Registriert die App-Installation und optional den Push-Token. Es wird ausschliesslich ' +
            'eine von der App erzeugte Installations-ID gespeichert — kein Hardware-Identifier (§21/§23).',
          security: [{ bearerAuth: [] }],
          body: registerDeviceSchema,
          response: { 200: z.object({ deviceId: uuidSchema, pushRegistered: z.boolean() }) },
        },
      },
      async (request) => {
        const body = request.body;
        const device = await ctx.db.queryOne<{ id: string }>(
          `INSERT INTO public.devices (user_id, install_id, platform, app_version, os_version)
           VALUES ($1, $2, $3::public.device_platform, $4, $5)
           ON CONFLICT (user_id, install_id) DO UPDATE SET
             app_version = EXCLUDED.app_version,
             os_version = EXCLUDED.os_version,
             last_seen_at = now()
           RETURNING id`,
          [request.user!.id, body.installId, body.platform, body.appVersion, body.osVersion ?? null],
        );
        if (!device) throw new AppError(ErrorCode.INTERNAL);

        let pushRegistered = false;
        if (body.pushToken) {
          await ctx.db.query(
            `INSERT INTO public.push_subscriptions (user_id, device_id, expo_push_token)
             VALUES ($1, $2, $3)
             ON CONFLICT (expo_push_token) DO UPDATE SET
               user_id = EXCLUDED.user_id, device_id = EXCLUDED.device_id,
               enabled = true, failure_count = 0, last_error = NULL`,
            [request.user!.id, device.id, body.pushToken],
          );
          pushRegistered = true;
        }
        return { deviceId: device.id, pushRegistered };
      },
    );

    // --- Datenexport und Löschung (§23) ---------------------------------------

    fastify.get(
      '/me/export',
      {
        config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
        schema: {
          tags: ['Konto'],
          summary: 'Alle eigenen Daten exportieren',
          description:
            'Liefert sämtliche zum Konto gespeicherten Daten als JSON — Auskunftsrecht nach ' +
            'DSGVO Art. 15 / CH-DSG Art. 25.',
          security: [{ bearerAuth: [] }],
          response: { 200: z.record(z.unknown()) },
        },
      },
      async (request) => {
        const userId = request.user!.id;
        const [profile, settings, reports, votes, favorites, sessions, devices, reputation] =
          await Promise.all([
            ctx.db.query('SELECT * FROM public.profiles WHERE id = $1', [userId]),
            ctx.db.query('SELECT * FROM public.user_settings WHERE user_id = $1', [userId]),
            ctx.db.query(
              `SELECT id, scope, status, category_id, trip_id, service_date, stop_id, message,
                      confidence, upvotes, downvotes, created_at, expires_at
               FROM public.reports WHERE user_id = $1`,
              [userId],
            ),
            ctx.db.query('SELECT report_id, vote, created_at FROM public.report_votes WHERE user_id = $1', [
              userId,
            ]),
            ctx.db.query('SELECT * FROM public.favorites WHERE user_id = $1', [userId]),
            ctx.db.query(
              `SELECT id, trip_id, service_date, confidence, detection_method, started_at, ended_at
               FROM public.trip_sessions WHERE user_id = $1`,
              [userId],
            ),
            ctx.db.query(
              'SELECT id, platform, app_version, created_at, last_seen_at FROM public.devices WHERE user_id = $1',
              [userId],
            ),
            ctx.db.query(
              'SELECT event_type, delta, created_at FROM public.user_reputation_events WHERE user_id = $1',
              [userId],
            ),
          ]);

        return {
          generatedAt: new Date().toISOString(),
          note:
            'Dieser Export enthält alle personenbezogenen Daten, die zu deinem Konto gespeichert sind. ' +
            'Standortdaten werden nur gerundet und nur zu aktiven Meldungen gespeichert.',
          profile: profile.rows[0] ?? null,
          settings: settings.rows[0] ?? null,
          reports: reports.rows,
          votes: votes.rows,
          favorites: favorites.rows,
          tripSessions: sessions.rows,
          devices: devices.rows,
          reputationEvents: reputation.rows,
        };
      },
    );

    fastify.delete(
      '/me',
      {
        schema: {
          tags: ['Konto'],
          summary: 'Konto löschen',
          description:
            'Löscht das Konto und alle personenbezogenen Daten. Veröffentlichte Meldungen werden ' +
            'entfernt. Der Vorgang ist nicht umkehrbar.',
          security: [{ bearerAuth: [] }],
          body: z.object({
            confirm: z.literal(true).describe('Muss explizit true sein.'),
          }),
          response: {
            200: z.object({
              deleted: z.boolean(),
              authAccountDeleted: z.boolean(),
              note: z.string(),
            }),
          },
        },
      },
      async (request) => {
        const userId = request.user!.id;

        // Reihenfolge zählt: erst Inhalte, dann Profil. Kaskaden erledigen den Rest.
        await ctx.db.transaction(async (tx) => {
          await tx.query('DELETE FROM public.reports WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.report_votes WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.report_flags WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.trip_sessions WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.trip_follows WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.favorites WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.push_subscriptions WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.devices WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.user_reputation_events WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.abuse_signals WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.notification_queue WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.user_settings WHERE user_id = $1', [userId]);
          await tx.query('DELETE FROM public.profiles WHERE id = $1', [userId]);
        });

        // Das Auth-Konto selbst liegt bei Supabase; ohne Service-Role-Key kann
        // die API es nicht entfernen. Das wird ehrlich zurückgemeldet (§55).
        let authAccountDeleted = false;
        if (ctx.env.SUPABASE_URL && ctx.env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const response = await fetch(
              `${ctx.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
              {
                method: 'DELETE',
                headers: {
                  apikey: ctx.env.SUPABASE_SERVICE_ROLE_KEY,
                  authorization: `Bearer ${ctx.env.SUPABASE_SERVICE_ROLE_KEY}`,
                },
                signal: AbortSignal.timeout(8000),
              },
            );
            authAccountDeleted = response.ok;
          } catch (error) {
            request.log.error({ err: error }, 'Auth-Konto konnte nicht gelöscht werden');
          }
        } else if (ctx.authMode === 'shim') {
          await ctx.db.query('DELETE FROM auth.users WHERE id = $1', [userId]);
          authAccountDeleted = true;
        }

        return {
          deleted: true,
          authAccountDeleted,
          note: authAccountDeleted
            ? 'Konto und alle Daten wurden gelöscht.'
            : 'Alle Anwendungsdaten wurden gelöscht. Das Anmeldekonto muss zusätzlich bei Supabase entfernt werden ' +
              '(SUPABASE_SERVICE_ROLE_KEY nicht konfiguriert).',
        };
      },
    );
  };

interface FavoriteRow {
  id: string;
  kind: 'STOP' | 'ROUTE' | 'JOURNEY';
  label: string;
  stop_id: string | null;
  route_id: string | null;
  origin_stop_id: string | null;
  destination_stop_id: string | null;
  sort_order: number;
  created_at: Date;
}

function toFavorite(row: FavoriteRow) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    stopId: row.stop_id,
    routeId: row.route_id,
    originStopId: row.origin_stop_id,
    destinationStopId: row.destination_stop_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
  };
}

async function listFavorites(ctx: AppContext, userId: string) {
  const { rows } = await ctx.db.query<FavoriteRow>(
    `SELECT id, kind, label, stop_id, route_id, origin_stop_id, destination_stop_id, sort_order, created_at
     FROM public.favorites WHERE user_id = $1 ORDER BY sort_order, created_at`,
    [userId],
  );
  return rows.map(toFavorite);
}
