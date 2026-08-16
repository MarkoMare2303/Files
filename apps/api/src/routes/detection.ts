import { AppError, ErrorCode } from '@swissov/shared';
import {
  gpsObservationSchema,
  startTripSessionInputSchema,
  tripDetectionRequestSchema,
  tripDetectionResponseSchema,
  tripSessionSchema,
  uuidSchema,
} from '@swissov/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { metrics } from '../lib/observability.js';
import type { ApiServices } from '../services/index.js';

/**
 * Fahrtenerkennung und Fahrt-Sitzungen (§10–§12, §36).
 *
 * Die Erkennung ist bewusst auch ohne Anmeldung nutzbar: Fahrgäste sollen die
 * App sofort ausprobieren können. Erst das Erstellen einer Sitzung — und damit
 * das Melden — erfordert ein Konto (§22).
 */
export const detectionRoutes =
  (ctx: AppContext, services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    fastify.post(
      '/trip-detection',
      {
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
          tags: ['Fahrtenerkennung'],
          summary: 'Fahrt anhand der Position erkennen',
          description:
            'Ermittelt Kandidatenfahrten aus GPS-Beobachtungen und bewertet sie. Die ' +
            'Positionsdaten werden ausschliesslich für diese Abfrage verwendet und nicht ' +
            'gespeichert (§60). Die Antwort enthält die Entscheidung (automatisch übernehmen, ' +
            'bestätigen lassen oder auswählen lassen) und die verwendeten Schwellenwerte.',
          body: tripDetectionRequestSchema,
          response: { 200: tripDetectionResponseSchema },
        },
      },
      async (request) => {
        const enabled = await ctx.flags.isEnabled('auto_trip_detection', request.user?.id);
        if (!enabled) {
          throw new AppError(ErrorCode.FEATURE_DISABLED, {
            message: 'auto_trip_detection ist deaktiviert',
            userMessage: {
              de: 'Die automatische Fahrterkennung ist derzeit deaktiviert. Du kannst deine Fahrt manuell auswählen.',
              en: 'Automatic trip detection is currently disabled. You can select your trip manually.',
            },
          });
        }

        const started = Date.now();
        const routeTypes = request.body.vehicleTypes
          ? routeTypesForVehicleTypes(request.body.vehicleTypes)
          : undefined;

        const result = await services.detection.detect(request.body.observations, {
          radiusMeters: request.body.radiusMeters,
          limit: request.body.limit,
          routeTypes,
        });

        metrics.observe('trip_detection.duration_ms', Date.now() - started);
        metrics.increment(`trip_detection.${result.decision}`);
        return result;
      },
    );

    fastify.get(
      '/trip-sessions/current',
      {
        onRequest: [fastify.requireAuth],
        schema: {
          tags: ['Fahrtenerkennung'],
          summary: 'Laufende Fahrt-Sitzung',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ session: tripSessionSchema.nullable() }) },
        },
      },
      async (request) => ({
        session: await services.detection.activeSession(request.user!.id),
      }),
    );

    fastify.post(
      '/trip-sessions',
      {
        onRequest: [fastify.requireAuth],
        schema: {
          tags: ['Fahrtenerkennung'],
          summary: 'Fahrt-Sitzung starten',
          description:
            'Bestätigt eine erkannte oder manuell gewählte Fahrt. Eine bereits offene Sitzung ' +
            'wird dabei beendet — ein Fahrgast kann sich nur in einem Fahrzeug befinden.',
          security: [{ bearerAuth: [] }],
          body: startTripSessionInputSchema,
          response: { 201: z.object({ session: tripSessionSchema }) },
        },
      },
      async (request, reply) => {
        const session = await services.detection.startSession(request.user!.id, request.body);
        metrics.increment(`trip_session.${request.body.detectionMethod}`);
        return reply.status(201).send({ session });
      },
    );

    fastify.post(
      '/trip-sessions/:sessionId/position',
      {
        onRequest: [fastify.requireAuth],
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
          tags: ['Fahrtenerkennung'],
          summary: 'Position der Sitzung aktualisieren',
          description:
            'Aktualisiert ausschliesslich die letzte bekannte Position. Es wird kein Verlauf ' +
            'geführt; beim Beenden der Sitzung wird die Position gelöscht (§23).',
          security: [{ bearerAuth: [] }],
          params: z.object({ sessionId: uuidSchema }),
          body: z.object({ observation: gpsObservationSchema }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await services.detection.updateSessionPosition(
          request.user!.id,
          request.params.sessionId,
          request.body.observation,
        );
        return reply.status(204).send(null);
      },
    );

    fastify.post(
      '/trip-sessions/:sessionId/follow',
      {
        onRequest: [fastify.requireAuth],
        schema: {
          tags: ['Fahrtenerkennung'],
          summary: 'Meldungen dieser Fahrt abonnieren (Smart Follow)',
          description:
            'Aktiviert Push-Benachrichtigungen für relevante neue Meldungen zu dieser Fahrt. ' +
            'Das Abonnement endet automatisch nach Fahrtende (§25).',
          security: [{ bearerAuth: [] }],
          params: z.object({ sessionId: uuidSchema }),
          body: z.object({ following: z.boolean() }),
          response: { 200: z.object({ session: tripSessionSchema }) },
        },
      },
      async (request) => {
        const pushEnabled = await ctx.flags.isEnabled('push_notifications', request.user!.id);
        if (request.body.following && !pushEnabled) {
          throw new AppError(ErrorCode.FEATURE_DISABLED, {
            message: 'push_notifications ist deaktiviert',
          });
        }
        const session = await services.detection.setFollowing(
          request.user!.id,
          request.params.sessionId,
          request.body.following,
        );
        return { session };
      },
    );

    fastify.delete(
      '/trip-sessions/:sessionId',
      {
        onRequest: [fastify.requireAuth],
        schema: {
          tags: ['Fahrtenerkennung'],
          summary: 'Fahrt-Sitzung beenden',
          security: [{ bearerAuth: [] }],
          params: z.object({ sessionId: uuidSchema }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await services.detection.endSession(request.user!.id, request.params.sessionId);
        return reply.status(204).send(null);
      },
    );
  };

/** Interne Fahrzeugkategorien auf GTFS `route_type`-Werte abbilden. */
function routeTypesForVehicleTypes(vehicleTypes: string[]): number[] {
  const map: Record<string, number[]> = {
    TRAM: [0, 900, 901, 902, 903, 904, 905, 906],
    SUBWAY: [1, 400, 401, 402, 403, 405],
    RAIL: [2, 100, 101, 102, 103, 105, 106, 107, 108, 109, 116],
    BUS: [3, 200, 201, 700, 701, 702, 704, 715, 1500, 1501],
    FERRY: [4, 1000, 1200],
    CABLE_TRAM: [5],
    AERIAL_LIFT: [6, 1300, 1301],
    FUNICULAR: [7, 1400],
    TROLLEYBUS: [11, 800],
    MONORAIL: [12, 405],
  };
  const result = new Set<number>();
  for (const vehicleType of vehicleTypes) {
    for (const routeType of map[vehicleType] ?? []) result.add(routeType);
  }
  return [...result];
}
