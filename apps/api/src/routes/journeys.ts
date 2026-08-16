import { journeySchema } from '@swissov/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { ApiServices } from '../services/index.js';

/**
 * Verbindungssuche (§8/§41).
 *
 * Hinter einer Provider-Abstraktion: bevorzugt Open Journey Planner,
 * andernfalls Direktverbindungen aus den eigenen GTFS-Daten. Die tatsächlich
 * verwendete Quelle und ihre Einschränkungen werden immer mitgeliefert, damit
 * die App ehrlich kommunizieren kann (§44/§55).
 */
export const journeyRoutes =
  (ctx: AppContext, _services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    fastify.get(
      '/journeys/search',
      {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['Verbindungen'],
          summary: 'Verbindungen suchen',
          querystring: z.object({
            from: z.string().min(1).max(255).describe('Start-Haltestellen-ID'),
            to: z.string().min(1).max(255).describe('Ziel-Haltestellen-ID'),
            at: z.string().datetime({ offset: true }).optional(),
            timeMode: z.enum(['DEPARTURE', 'ARRIVAL']).default('DEPARTURE'),
            results: z.coerce.number().int().min(1).max(10).default(5),
            locale: z.enum(['de', 'fr', 'it', 'en']).default('de'),
          }),
          response: {
            200: z.object({
              journeys: z.array(journeySchema),
              provider: z.string(),
              limitations: z.array(z.string()),
            }),
          },
        },
      },
      async (request) => {
        const { from, to, at, timeMode, results, locale } = request.query;
        return ctx.journeys.search({
          originStopId: from,
          destinationStopId: to,
          at: at ? new Date(at) : new Date(),
          timeMode,
          results,
          locale,
        });
      },
    );
  };
