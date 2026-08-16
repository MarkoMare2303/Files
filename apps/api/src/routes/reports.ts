import { AppError, ErrorCode } from '@swissov/shared';
import {
  createReportInputSchema,
  feedItemSchema,
  flagInputSchema,
  gtfsIdSchema,
  reportCategorySchema,
  reportQuerySchema,
  reportSchema,
  serviceDateSchema,
  uuidSchema,
  voteInputSchema,
} from '@swissov/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { hashIp } from '../lib/crypto.js';
import { metrics } from '../lib/observability.js';
import type { ApiServices } from '../services/index.js';

/**
 * Community-Meldungen (§14–§19).
 *
 * Lesen ist im Gastmodus erlaubt, Schreiben erfordert ein Konto (§22).
 * Sämtliche Missbrauchsprüfungen laufen serverseitig im ReportsService.
 */
export const reportRoutes =
  (ctx: AppContext, services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    fastify.get(
      '/reports/categories',
      {
        schema: {
          tags: ['Meldungen'],
          summary: 'Verfügbare Meldungskategorien',
          description:
            'Kategorien werden administrativ gepflegt. Die App rendert das Melden-Sheet ' +
            'vollständig aus dieser Liste — neue Kategorien erscheinen ohne App-Update.',
          response: { 200: z.object({ categories: z.array(reportCategorySchema) }) },
        },
      },
      async () => ({ categories: await services.reports.categories() }),
    );

    fastify.get(
      '/reports',
      {
        schema: {
          tags: ['Meldungen'],
          summary: 'Meldungen abfragen',
          description:
            'Filterbar nach Fahrt, Linie, Haltestelle oder Umkreis. Mit `includeOfficial` werden ' +
            'zusätzlich offizielle Störungsmeldungen geliefert — klar unterscheidbar über das ' +
            'Feld `source`.',
          querystring: reportQuerySchema,
          response: { 200: z.object({ items: z.array(feedItemSchema) }) },
        },
      },
      async (request) => {
        const viewerId = request.user?.id ?? null;
        const reports = await services.reports.list(request.query, viewerId);

        if (!request.query.includeOfficial) return { items: reports };

        const alerts = await services.transit.activeAlerts({
          routeIds: request.query.routeId ? [request.query.routeId] : [],
          stopIds: request.query.stopId ? [request.query.stopId] : [],
          tripIds: request.query.tripId ? [request.query.tripId] : [],
          limit: 25,
        });

        const officialItems = alerts.map((alert) => ({
          source: 'OFFICIAL' as const,
          id: alert.id,
          severity: alert.severity,
          header: alert.header,
          description: alert.description,
          url: alert.url,
          cause: alert.cause,
          effect: alert.effect,
          affectedRouteIds: alert.affectedRouteIds,
          affectedStopIds: alert.affectedStopIds,
          activeFrom: alert.activeFrom,
          activeUntil: alert.activeUntil,
          updatedAt: alert.updatedAt,
        }));

        // Offizielle Meldungen stehen immer oben — sie sind verbindlich.
        return { items: [...officialItems, ...reports] };
      },
    );

    fastify.get(
      '/trips/:tripId/reports',
      {
        schema: {
          tags: ['Meldungen'],
          summary: 'Meldungen zu einer Fahrt',
          params: z.object({ tripId: gtfsIdSchema }),
          querystring: z.object({
            serviceDate: serviceDateSchema.optional(),
            includeOfficial: z.coerce.boolean().default(true),
          }),
          response: { 200: z.object({ items: z.array(feedItemSchema) }) },
        },
      },
      async (request) => {
        const viewerId = request.user?.id ?? null;
        const reports = await services.reports.list(
          {
            tripId: request.params.tripId,
            serviceDate: request.query.serviceDate,
            radiusMeters: 3000,
            includeOfficial: request.query.includeOfficial,
            limit: 50,
          },
          viewerId,
        );
        if (!request.query.includeOfficial) return { items: reports };

        const alerts = await services.transit.activeAlerts({
          tripIds: [request.params.tripId],
          limit: 10,
        });
        return {
          items: [
            ...alerts.map((alert) => ({
              source: 'OFFICIAL' as const,
              id: alert.id,
              severity: alert.severity,
              header: alert.header,
              description: alert.description,
              url: alert.url,
              cause: alert.cause,
              effect: alert.effect,
              affectedRouteIds: alert.affectedRouteIds,
              affectedStopIds: alert.affectedStopIds,
              activeFrom: alert.activeFrom,
              activeUntil: alert.activeUntil,
              updatedAt: alert.updatedAt,
            })),
            ...reports,
          ],
        };
      },
    );

    fastify.post(
      '/reports',
      {
        onRequest: [fastify.requireAuth],
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['Meldungen'],
          summary: 'Meldung erstellen',
          description:
            'Erzeugt eine Community-Meldung. Kontext (Fahrt, Linie, Halt) wird serverseitig aus ' +
            'der aktiven Fahrt-Sitzung oder den übergebenen IDs abgeleitet. Missbrauchsschutz, ' +
            'Trust Score und Ablaufzeit werden ausschliesslich serverseitig bestimmt.\n\n' +
            'Für die Offline-Queue kann eine `clientReportId` mitgegeben werden — mehrfaches ' +
            'Senden derselben ID erzeugt keine Duplikate.',
          security: [{ bearerAuth: [] }],
          body: createReportInputSchema,
          response: {
            201: z.object({
              report: reportSchema,
              mergedInto: uuidSchema.optional(),
              warnings: z.array(z.string()),
            }),
          },
        },
      },
      async (request, reply) => {
        const enabled = await ctx.flags.isEnabled('community_reports', request.user!.id);
        if (!enabled) throw new AppError(ErrorCode.FEATURE_DISABLED);

        await ctx.profiles.assertCanContribute(request.user!.profile);

        const result = await services.reports.create(request.user!.profile, request.body, {
          ipHash: request.ipHash,
          installId: extractInstallId(request.headers['x-install-id']),
        });

        metrics.increment(`report.created.${request.body.categoryKey}`);
        return reply.status(201).send(result);
      },
    );

    fastify.post(
      '/reports/:reportId/vote',
      {
        onRequest: [fastify.requireAuth],
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['Meldungen'],
          summary: 'Meldung bestätigen oder als überholt markieren',
          description:
            'Genau eine Stimme pro Nutzer und Meldung (§18). Erneutes Abstimmen ersetzt die ' +
            'vorherige Stimme. Eigene Meldungen können nicht bewertet werden.',
          security: [{ bearerAuth: [] }],
          params: z.object({ reportId: uuidSchema }),
          body: voteInputSchema,
          response: { 200: z.object({ report: reportSchema }) },
        },
      },
      async (request) => {
        await ctx.profiles.assertCanContribute(request.user!.profile);
        const report = await services.reports.vote(
          request.user!.profile,
          request.params.reportId,
          request.body.vote,
        );
        metrics.increment(request.body.vote === 1 ? 'report.confirmed' : 'report.disputed');
        return { report };
      },
    );

    fastify.post(
      '/reports/:reportId/flag',
      {
        onRequest: [fastify.requireAuth],
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          tags: ['Meldungen'],
          summary: 'Meldung als problematisch melden',
          description:
            'Ab einer konfigurierbaren Anzahl Meldungen wandert der Beitrag automatisch in die ' +
            'Moderations-Queue und ist bis zur Prüfung nicht mehr öffentlich sichtbar.',
          security: [{ bearerAuth: [] }],
          params: z.object({ reportId: uuidSchema }),
          body: flagInputSchema,
          response: { 200: z.object({ queuedForModeration: z.boolean() }) },
        },
      },
      async (request) => {
        await ctx.profiles.assertCanContribute(request.user!.profile);
        return services.reports.flag(
          request.user!.profile,
          request.params.reportId,
          request.body.reason,
          request.body.note,
        );
      },
    );

    fastify.get(
      '/reports/:reportId',
      {
        schema: {
          tags: ['Meldungen'],
          summary: 'Einzelne Meldung',
          params: z.object({ reportId: uuidSchema }),
          response: { 200: z.object({ report: reportSchema }) },
        },
      },
      async (request) => {
        const report = await services.reports.byId(request.params.reportId, request.user?.id ?? null);
        if (!report) throw new AppError(ErrorCode.NOT_FOUND);
        return { report };
      },
    );
  };

function extractInstallId(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export { hashIp };
