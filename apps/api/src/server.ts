import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppContext } from './context.js';
import { hashIp } from './lib/crypto.js';
import { metrics } from './lib/observability.js';
import authPlugin, { type TokenVerifier } from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import { adminRoutes } from './routes/admin.js';
import { appConfigRoutes } from './routes/app-config.js';
import { detectionRoutes } from './routes/detection.js';
import { healthRoutes } from './routes/health.js';
import { journeyRoutes } from './routes/journeys.js';
import { meRoutes } from './routes/me.js';
import { reportRoutes } from './routes/reports.js';
import { transitRoutes } from './routes/transit.js';
import { createServices } from './services/index.js';

export interface BuildServerOptions {
  context: AppContext;
  /** Nur für Tests: ersetzt die Token-Prüfung. */
  verifier?: TokenVerifier;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const ctx = options.context;
  const services = createServices(ctx);

  const fastify = Fastify({
    logger: {
      level: ctx.env.LOG_LEVEL,
      // Zugangsdaten und Positionsdaten dürfen nicht in Logs landen (§23).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-install-id"]',
          'req.body.observations',
          'req.body.lat',
          'req.body.lon',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      transport:
        ctx.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    // Vertraut Proxy-Headern nur, wenn die App hinter einem Reverse Proxy läuft.
    trustProxy: ctx.env.NODE_ENV === 'production',
    // Uploads/Bodies bewusst klein halten (§42 Upload Limits).
    bodyLimit: 128 * 1024,
    requestTimeout: 30_000,
  }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  fastify.decorate('ctx', ctx);

  await fastify.register(errorHandlerPlugin, { errors: ctx.errors });

  await fastify.register(helmet, {
    // Die API liefert JSON, kein HTML — CSP kann sehr restriktiv bleiben.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // Swagger-UI benötigt eigene Assets; nur in Nicht-Produktion aktiv.
        ...(ctx.env.NODE_ENV === 'production'
          ? {}
          : {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
            }),
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await fastify.register(cors, {
    // Leere Liste = keine Browser-Origins erlaubt. Die Mobile-App ist kein
    // Browser-Client und von CORS nicht betroffen.
    origin: ctx.env.API_CORS_ORIGINS.length > 0 ? ctx.env.API_CORS_ORIGINS : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-install-id', 'accept-language'],
    maxAge: 3600,
  });

  await fastify.register(rateLimit, {
    global: true,
    max: ctx.env.RATE_LIMIT_GLOBAL_PER_MINUTE,
    timeWindow: '1 minute',
    // Angemeldete Nutzer werden pro Konto begrenzt, Gäste pro (gehashter) IP.
    keyGenerator: (request) => request.user?.id ?? request.ipHash ?? request.ip,
    // /health und /ready müssen auch unter Last antworten.
    allowList: (request) => request.url === '/health' || request.url === '/ready',
  });

  // IP früh pseudonymisieren, damit die Klartext-IP nirgends weiterverwendet wird.
  fastify.addHook('onRequest', async (request) => {
    request.ipHash = request.ip ? hashIp(request.ip, ctx.env.API_INTERNAL_SECRET) : null;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? 'unknown';
    metrics.increment(`http.${reply.statusCode}`);
    metrics.observe(`http.${request.method}.${route}`, reply.elapsedTime);
  });

  await fastify.register(authPlugin, {
    context: ctx,
    ...(options.verifier ? { verifier: options.verifier } : {}),
  });

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Schweizer ÖV Live — API',
        version: '0.1.0',
        description:
          'REST-API der Schweizer ÖV Live Community App.\n\n' +
          '**Quellenkennzeichnung:** Antworten unterscheiden konsequent zwischen offiziellen ' +
          'Daten (`source: "OFFICIAL"`, aus GTFS-RT Service Alerts der Betreiber) und ' +
          'Community-Meldungen (`source: "COMMUNITY"`). Diese Trennung darf in keiner ' +
          'Oberfläche aufgehoben werden.\n\n' +
          '**Authentifizierung:** Bearer-Token aus Supabase Auth. Ohne Token ist ein ' +
          'eingeschränkter Gastmodus (nur Lesen) verfügbar.',
        license: { name: 'UNLICENSED' },
      },
      servers: [{ url: ctx.env.API_PUBLIC_URL, description: 'Diese Instanz' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'Betrieb', description: 'Health-, Readiness- und Metrik-Endpunkte' },
        { name: 'Konfiguration', description: 'Startkonfiguration der App' },
        { name: 'Fahrplan', description: 'Haltestellen, Linien, Fahrten, Abfahrten, Suche' },
        { name: 'Störungen', description: 'Offizielle Meldungen der Betreiber' },
        { name: 'Fahrtenerkennung', description: 'Automatische und manuelle Fahrtzuordnung' },
        { name: 'Meldungen', description: 'Community-Meldungen, Bestätigungen, Missbrauchsmeldungen' },
        { name: 'Verbindungen', description: 'Verbindungssuche' },
        { name: 'Konto', description: 'Profil, Einstellungen, Favoriten, Datenexport, Löschung' },
        { name: 'Admin', description: 'Moderation und Administration' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  // Swagger-UI wird in Produktion nicht ausgeliefert — die Spezifikation
  // bleibt über /openapi.json erreichbar.
  if (ctx.env.NODE_ENV !== 'production') {
    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }

  fastify.get('/openapi.json', { schema: { hide: true } }, async () => fastify.swagger());

  await fastify.register(healthRoutes(ctx, services));
  await fastify.register(
    async (instance) => {
      await instance.register(appConfigRoutes(ctx, services));
      await instance.register(transitRoutes(ctx, services));
      await instance.register(detectionRoutes(ctx, services));
      await instance.register(reportRoutes(ctx, services));
      await instance.register(journeyRoutes(ctx, services));
      await instance.register(meRoutes(ctx, services));
    },
    { prefix: '/v1' },
  );
  await fastify.register(adminRoutes(ctx, services), { prefix: '/v1/admin' });

  return fastify;
}
