import { AppError, ErrorCode } from '@swissov/shared';
import {
  departureSchema,
  gtfsIdSchema,
  routeSchema,
  serviceAlertSchema,
  serviceDateSchema,
  stopSchema,
  tripSchema,
  vehicleTypeFromRouteType,
} from '@swissov/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { ApiServices } from '../services/index.js';

/**
 * Fahrplan- und Geo-Endpunkte (§41).
 * Alle Antworten sind über Zod-Schemas typisiert und fliessen in die
 * OpenAPI-Dokumentation ein.
 */
export const transitRoutes =
  (ctx: AppContext, services: ApiServices): FastifyPluginAsyncZod =>
  async (fastify) => {
    fastify.get(
      '/stops/nearby',
      {
        schema: {
          tags: ['Fahrplan'],
          summary: 'Haltestellen in der Nähe',
          description:
            'Liefert Haltestellen im angegebenen Umkreis, sortiert nach Distanz. Die Suche läuft ' +
            'als PostGIS-Abfrage auf dem Server — der Client lädt nie vollständige Datensätze.',
          querystring: z.object({
            lat: z.coerce.number().min(-90).max(90),
            lon: z.coerce.number().min(-180).max(180),
            radius: z.coerce.number().int().min(50).max(20_000).default(800),
            limit: z.coerce.number().int().min(1).max(100).default(25),
            includePlatforms: z.coerce.boolean().default(false),
          }),
          response: { 200: z.object({ stops: z.array(stopSchema) }) },
        },
      },
      async (request) => {
        const { lat, lon, radius, limit, includePlatforms } = request.query;
        const stops = await services.transit.stopsNearby(lat, lon, radius, limit, !includePlatforms);
        return { stops };
      },
    );

    fastify.get(
      '/stops/:stopId',
      {
        schema: {
          tags: ['Fahrplan'],
          summary: 'Einzelne Haltestelle',
          params: z.object({ stopId: gtfsIdSchema }),
          response: { 200: z.object({ stop: stopSchema }) },
        },
      },
      async (request) => {
        const stop = await services.transit.getStop(request.params.stopId);
        if (!stop) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Haltestelle nicht gefunden' });
        return { stop };
      },
    );

    fastify.get(
      '/stops/:stopId/departures',
      {
        schema: {
          tags: ['Fahrplan'],
          summary: 'Nächste Abfahrten',
          description:
            'Fahrplanabfahrten inklusive Echtzeit-Verspätungen aus GTFS-RT. Umfasst automatisch ' +
            'alle Kanten und Gleise der Station.',
          params: z.object({ stopId: gtfsIdSchema }),
          querystring: z.object({
            at: z.string().datetime({ offset: true }).optional(),
            limit: z.coerce.number().int().min(1).max(50).default(20),
          }),
          response: {
            200: z.object({
              departures: z.array(departureSchema),
              /** Ob Echtzeitdaten verfügbar waren (§44 — ehrliche Fallback-Anzeige). */
              realtimeAvailable: z.boolean(),
            }),
          },
        },
      },
      async (request) => {
        const at = request.query.at ? new Date(request.query.at) : new Date();
        const departures = await services.transit.getDepartures(
          request.params.stopId,
          at,
          request.query.limit,
        );
        return {
          departures,
          realtimeAvailable: departures.some((d) => d.delaySeconds !== null),
        };
      },
    );

    fastify.get(
      '/departures',
      {
        schema: {
          tags: ['Fahrplan'],
          summary: 'Abfahrten mehrerer Haltestellen',
          description: 'Sammelabfrage für die Startseite (Favoriten, Haltestellen in der Nähe).',
          querystring: z.object({
            stopIds: z.string().min(1).max(1000),
            limit: z.coerce.number().int().min(1).max(20).default(6),
          }),
          response: {
            200: z.object({
              byStop: z.array(z.object({ stopId: gtfsIdSchema, departures: z.array(departureSchema) })),
            }),
          },
        },
      },
      async (request) => {
        const stopIds = request.query.stopIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .slice(0, 10);
        const now = new Date();
        const byStop = await Promise.all(
          stopIds.map(async (stopId) => ({
            stopId,
            departures: await services.transit.getDepartures(stopId, now, request.query.limit),
          })),
        );
        return { byStop };
      },
    );

    fastify.get(
      '/routes/:routeId',
      {
        schema: {
          tags: ['Fahrplan'],
          summary: 'Linie',
          params: z.object({ routeId: gtfsIdSchema }),
          response: { 200: z.object({ route: routeSchema }) },
        },
      },
      async (request) => {
        const row = await ctx.db.queryOne<{
          route_id: string;
          agency_id: string | null;
          agency_name: string | null;
          short_name: string | null;
          long_name: string | null;
          route_type: number;
          color: string | null;
          text_color: string | null;
        }>(
          `SELECT r.route_id, r.agency_id, a.name AS agency_name, r.short_name, r.long_name,
                  r.route_type, r.color, r.text_color
           FROM transit.routes r
           LEFT JOIN transit.agencies a ON a.feed_id = r.feed_id AND a.agency_id = r.agency_id
           WHERE r.feed_id = transit.active_feed_id() AND r.route_id = $1`,
          [request.params.routeId],
        );
        if (!row) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Linie nicht gefunden' });
        return {
          route: {
            routeId: row.route_id,
            agencyId: row.agency_id,
            agencyName: row.agency_name,
            shortName: row.short_name,
            longName: row.long_name,
            routeType: row.route_type,
            vehicleType: vehicleTypeFromRouteType(row.route_type),
            color: row.color,
            textColor: row.text_color,
          },
        };
      },
    );

    fastify.get(
      '/trips/:tripId',
      {
        schema: {
          tags: ['Fahrplan'],
          summary: 'Fahrt mit allen Halten',
          description:
            'Vollständiger Fahrtverlauf inkl. Echtzeit-Prognosen. `serviceDate` identifiziert ' +
            'zusammen mit der `tripId` genau eine Fahrt (GTFS-RT-Konvention).',
          params: z.object({ tripId: gtfsIdSchema }),
          querystring: z.object({ serviceDate: serviceDateSchema.optional() }),
          response: { 200: z.object({ trip: tripSchema }) },
        },
      },
      async (request) => {
        const serviceDate =
          request.query.serviceDate ??
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Zurich',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date());
        const trip = await services.transit.getTrip(request.params.tripId, serviceDate);
        if (!trip) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Fahrt nicht gefunden' });
        return { trip };
      },
    );

    fastify.get(
      '/search',
      {
        schema: {
          tags: ['Fahrplan'],
          summary: 'Globale Suche',
          description:
            'Unscharfe Suche über Haltestellen und Linien (Trigramm-Index, diakritikaunabhängig). ' +
            '„Zurich" findet „Zürich", „IC3" findet „IC 3".',
          querystring: z.object({
            q: z.string().min(2).max(100),
            limit: z.coerce.number().int().min(1).max(30).default(12),
          }),
          response: {
            200: z.object({
              results: z.array(
                z.object({
                  kind: z.enum(['STOP', 'ROUTE']),
                  id: gtfsIdSchema,
                  name: z.string(),
                  subtitle: z.string().nullable(),
                  lat: z.number().nullable(),
                  lon: z.number().nullable(),
                  vehicleType: z.string().nullable(),
                  score: z.number(),
                }),
              ),
            }),
          },
        },
      },
      async (request) => {
        const rows = await services.transit.search(request.query.q, request.query.limit);
        return {
          results: rows.map((row) => ({
            kind: row.kind,
            id: row.id,
            name: row.name,
            subtitle: row.subtitle,
            lat: row.lat,
            lon: row.lon,
            vehicleType: row.route_type === null ? null : vehicleTypeFromRouteType(row.route_type),
            score: Number(row.score),
          })),
        };
      },
    );

    fastify.get(
      '/alerts',
      {
        schema: {
          tags: ['Störungen'],
          summary: 'Offizielle Störungsmeldungen',
          description:
            'OFFIZIELLE Meldungen der Betreiber aus GTFS-RT Service Alerts. Diese Quelle ist ' +
            'strikt von Community-Meldungen getrennt (§7).',
          querystring: z.object({
            routeId: gtfsIdSchema.optional(),
            stopId: gtfsIdSchema.optional(),
            tripId: gtfsIdSchema.optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          }),
          response: { 200: z.object({ alerts: z.array(serviceAlertSchema) }) },
        },
      },
      async (request) => {
        const { routeId, stopId, tripId, limit } = request.query;
        const alerts = await services.transit.activeAlerts({
          routeIds: routeId ? [routeId] : [],
          stopIds: stopId ? [stopId] : [],
          tripIds: tripId ? [tripId] : [],
          limit,
        });
        return { alerts };
      },
    );
  };
