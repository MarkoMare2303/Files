import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../context.js';
import { metrics } from '../lib/observability.js';
import type { ApiServices } from '../services/index.js';

/**
 * Betriebsendpunkte (§43).
 *
 *   /health  — lebt der Prozess? (Liveness, immer schnell)
 *   /ready   — kann er Anfragen bedienen? (Readiness, prüft Abhängigkeiten)
 *   /metrics — Kennzahlen; nur für Administratoren
 */
const componentStatusSchema = z.object({
  component: z.string(),
  status: z.enum(['OK', 'DEGRADED', 'DOWN', 'UNKNOWN']),
  message: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
});

export const healthRoutes =
  (ctx: AppContext, services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    fastify.get(
      '/health',
      {
        schema: {
          tags: ['Betrieb'],
          summary: 'Liveness-Probe',
          description: 'Antwortet, solange der Prozess läuft. Prüft bewusst keine Abhängigkeiten.',
          response: {
            200: z.object({
              status: z.literal('ok'),
              uptimeSeconds: z.number(),
              version: z.string(),
            }),
          },
        },
      },
      async () => ({
        status: 'ok' as const,
        uptimeSeconds: Math.round(process.uptime()),
        version: process.env.npm_package_version ?? '0.1.0',
      }),
    );

    fastify.get(
      '/ready',
      {
        schema: {
          tags: ['Betrieb'],
          summary: 'Readiness-Probe',
          description:
            'Prüft Datenbank, Cache, Fahrplandaten, Echtzeit-Feeds und den Routenplaner.',
          response: {
            200: z.object({ status: z.enum(['ok', 'degraded']), components: z.array(componentStatusSchema) }),
            503: z.object({ status: z.literal('down'), components: z.array(componentStatusSchema) }),
          },
        },
      },
      async (_request, reply) => {
        const [database, cache, feed, feedHealth, journeys, realtime] = await Promise.all([
          ctx.db.healthcheck(),
          ctx.cache.healthcheck(),
          services.transit.activeFeedId().catch(() => null),
          ctx.db
            .query<{
              component: string;
              last_success_at: Date | null;
              last_error: string | null;
              consecutive_failures: number;
            }>('SELECT component, last_success_at, last_error, consecutive_failures FROM transit.feed_health')
            .then((r) => r.rows)
            .catch(() => []),
          ctx.journeys.healthcheck(),
          ctx.realtime.healthcheck(),
        ]);

        const components: Array<z.infer<typeof componentStatusSchema>> = [
          {
            component: 'database',
            status: database.ok ? 'OK' : 'DOWN',
            message: database.error ?? `${database.latencyMs} ms`,
            lastSuccessAt: null,
          },
          {
            component: `cache:${cache.driver}`,
            status: cache.ok ? 'OK' : 'DEGRADED',
            message: cache.message ?? null,
            lastSuccessAt: null,
          },
          {
            component: 'gtfs_static',
            status: feed ? 'OK' : 'DOWN',
            message: feed ? null : 'Keine aktive Fahrplanversion importiert',
            lastSuccessAt: null,
          },
          {
            component: 'journey_planner',
            status: journeys.ok ? 'OK' : 'DEGRADED',
            message: journeys.message ?? null,
            lastSuccessAt: null,
          },
          {
            component: 'realtime_broadcast',
            status: realtime.ok ? 'OK' : 'DEGRADED',
            message: realtime.message ?? null,
            lastSuccessAt: null,
          },
        ];

        for (const row of feedHealth) {
          if (row.component === 'gtfs_static') continue;
          components.push({
            component: row.component,
            status:
              row.consecutive_failures === 0
                ? 'OK'
                : row.consecutive_failures < 5
                  ? 'DEGRADED'
                  : 'DOWN',
            message: row.last_error,
            lastSuccessAt: row.last_success_at?.toISOString() ?? null,
          });
        }

        // Nur Datenbank und Fahrplandaten sind für die Bereitschaft zwingend;
        // fehlende Echtzeitdaten degradieren, blockieren aber nicht.
        const isDown = components.some(
          (c) => c.status === 'DOWN' && (c.component === 'database' || c.component === 'gtfs_static'),
        );
        if (isDown) return reply.status(503).send({ status: 'down' as const, components });

        const degraded = components.some((c) => c.status !== 'OK');
        return reply.send({ status: degraded ? ('degraded' as const) : ('ok' as const), components });
      },
    );

    fastify.get(
      '/metrics',
      {
        onRequest: [fastify.requireAdmin],
        schema: {
          tags: ['Betrieb'],
          summary: 'API-Kennzahlen',
          description: 'Zähler und Latenz-Perzentile des laufenden Prozesses. Nur für Administratoren.',
          security: [{ bearerAuth: [] }],
          response: { 200: z.record(z.unknown()) },
        },
      },
      async () => metrics.snapshot(),
    );
  };
