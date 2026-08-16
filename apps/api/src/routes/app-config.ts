import { reportCategorySchema } from '@swissov/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { ApiServices } from '../services/index.js';

/**
 * Startkonfiguration für die App.
 *
 * Ein einziger Aufruf beim Kaltstart liefert Kategorien, aktive Features und
 * Erkennungsschwellen. Dadurch kommt die App ohne fest einkompilierte Listen
 * aus und übernimmt administrative Änderungen ohne Update (§32/§62).
 */
export const appConfigRoutes =
  (ctx: AppContext, services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    fastify.get(
      '/app-config',
      {
        schema: {
          tags: ['Konfiguration'],
          summary: 'Startkonfiguration der App',
          response: {
            200: z.object({
              categories: z.array(reportCategorySchema),
              features: z.record(z.boolean()),
              detection: z.object({
                autoThreshold: z.number(),
                confirmThreshold: z.number(),
                defaultRadiusMeters: z.number(),
              }),
              limits: z.object({
                messageMaxLength: z.number(),
                reportsPerHour: z.number(),
              }),
              /** Ob offizielle Echtzeitdaten aktuell verfügbar sind (§44). */
              dataSources: z.object({
                timetable: z.boolean(),
                realtime: z.boolean(),
                officialAlerts: z.boolean(),
                journeyPlanner: z.string(),
              }),
            }),
          },
        },
      },
      async (request) => {
        const userId = request.user?.id;
        const [categories, flags, detection, rateLimits, feedId, health] = await Promise.all([
          services.reports.categories(),
          ctx.flags.all(),
          ctx.config.detection(),
          ctx.config.rateLimits(),
          services.transit.activeFeedId(),
          ctx.db
            .query<{ component: string; last_success_at: Date | null }>(
              'SELECT component, last_success_at FROM transit.feed_health',
            )
            .then((r) => r.rows)
            .catch(() => []),
        ]);

        const features: Record<string, boolean> = {};
        for (const flag of flags) {
          features[flag.key] = await ctx.flags.isEnabled(flag.key, userId);
        }

        const recent = (component: string): boolean => {
          const row = health.find((h) => h.component === component);
          if (!row?.last_success_at) return false;
          // Älter als 10 Minuten gilt nicht mehr als „verfügbar".
          return Date.now() - row.last_success_at.getTime() < 10 * 60_000;
        };

        return {
          categories,
          features,
          detection: {
            autoThreshold: detection.autoThreshold,
            confirmThreshold: detection.confirmThreshold,
            defaultRadiusMeters: detection.defaultRadiusMeters,
          },
          limits: {
            messageMaxLength: 280,
            reportsPerHour: rateLimits.reportsPerHour,
          },
          dataSources: {
            timetable: feedId !== null,
            realtime: recent('gtfs_rt_trip_updates'),
            officialAlerts: recent('service_alerts'),
            journeyPlanner: ctx.journeys.usesOjp ? 'ojp' : 'gtfs-direct',
          },
        };
      },
    );
  };
