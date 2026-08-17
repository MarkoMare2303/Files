import { createServer } from 'node:http';
import {
  detectMissingIntegrations,
  loadEnvFiles,
  parseEnv,
  resolveTransitApiKeys,
  workerEnvSchema,
} from '@swissov/config';
import { createDatabase } from '@swissov/database';
import { importGtfsStatic } from '@swissov/transit';
import {
  createExpiryJob,
  createRetentionJob,
  createSessionCleanupJob,
  createTrustRefreshJob,
} from './jobs/maintenance.job.js';
import { createPushJob } from './jobs/push.job.js';
import { createServiceAlertsJob, createTripUpdatesJob } from './jobs/realtime.job.js';
import { createLogger } from './logger.js';
import { Scheduler } from './scheduler.js';
import { recomputeTrustScore } from './trust.js';

/**
 * Hintergrunddienste (§43).
 *
 * Läuft getrennt vom API-Server, damit lange Importe und Poller die
 * Antwortzeiten der API nicht beeinflussen.
 */
async function main(): Promise<void> {
  loadEnvFiles();
  const env = parseEnv(workerEnvSchema);
  const logger = createLogger(env.LOG_LEVEL === 'silent' ? 'error' : (env.LOG_LEVEL as never), {
    service: 'worker',
  });

  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    applicationName: 'swissov-worker',
    // Der GTFS-Import führt sehr lange Statements aus.
    statementTimeoutMs: 3_600_000,
  });

  const missing = detectMissingIntegrations(env);
  if (missing.length > 0) {
    logger.warn('Optionale Integrationen ohne Konfiguration', { missing });
  }

  const scheduler = new Scheduler(logger);

  scheduler.register({
    name: 'gtfs_rt_trip_updates',
    intervalSeconds: env.GTFS_RT_POLL_INTERVAL_SECONDS,
    runOnStart: true,
    run: createTripUpdatesJob(db, env, logger.child({ job: 'gtfs_rt_trip_updates' })),
  });

  scheduler.register({
    name: 'service_alerts',
    intervalSeconds: env.SERVICE_ALERTS_POLL_INTERVAL_SECONDS,
    runOnStart: true,
    run: createServiceAlertsJob(db, env, logger.child({ job: 'service_alerts' })),
  });

  scheduler.register({
    name: 'report_expiry',
    intervalSeconds: env.EXPIRY_JOB_INTERVAL_SECONDS,
    runOnStart: true,
    run: createExpiryJob(db, logger.child({ job: 'report_expiry' })),
  });

  scheduler.register({
    name: 'trip_session_cleanup',
    intervalSeconds: 300,
    run: createSessionCleanupJob(db, logger.child({ job: 'trip_session_cleanup' })),
  });

  scheduler.register({
    name: 'trust_refresh',
    intervalSeconds: 600,
    run: createTrustRefreshJob(
      db,
      (reportId) => recomputeTrustScore(db, reportId),
      logger.child({ job: 'trust_refresh' }),
    ),
  });

  scheduler.register({
    name: 'push_dispatch',
    intervalSeconds: 20,
    run: createPushJob(db, env, logger.child({ job: 'push_dispatch' })),
  });

  scheduler.register({
    name: 'retention',
    cron: '30 3 * * *',
    run: createRetentionJob(db, logger.child({ job: 'retention' })),
  });

  scheduler.register({
    name: 'gtfs_static_import',
    cron: env.GTFS_IMPORT_CRON,
    runOnStart: env.GTFS_IMPORT_ON_BOOT,
    run: async () => {
      const jobLogger = logger.child({ job: 'gtfs_static_import' });
      const active = await db.queryOne<{ id: string | null }>(
        'SELECT transit.active_feed_id() AS id',
      );
      if (active?.id && !env.GTFS_IMPORT_ON_BOOT) {
        jobLogger.info('Prüfe auf neue Fahrplanversion');
      }
      const result = await importGtfsStatic(db, {
        url: env.GTFS_STATIC_URL,
        // Der Fahrplan liegt im CKAN-Portal — eigener Dienst, eigenes Token.
        apiKey: resolveTransitApiKeys(env).ckan,
        authScheme: env.OPENTRANSPORTDATA_AUTH_SCHEME,
        log: (message) => jobLogger.info(message),
      });
      jobLogger.info('GTFS-Import beendet', { status: result.status, feedId: result.feedId });
    },
  });

  // Health-Endpunkt des Workers: zeigt den Zustand jedes Jobs.
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));
      return;
    }
    if (request.url === '/ready') {
      void db.healthcheck().then((health) => {
        const jobs = scheduler.snapshot();
        // Ein Job gilt als kritisch, wenn er mehrfach hintereinander scheitert.
        const failing = jobs.filter((job) => job.failures > 0 && job.runs === 0);
        const ok = health.ok && failing.length === 0;
        response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            status: ok ? 'ok' : 'degraded',
            database: health,
            jobs: jobs.map((job) => ({
              name: job.name,
              runs: job.runs,
              failures: job.failures,
              lastRunAt: job.lastRunAt,
              lastDurationMs: job.lastDurationMs,
              lastError: job.lastError,
            })),
          }),
        );
      });
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(env.WORKER_PORT, () => {
    logger.info('Worker gestartet', { port: env.WORKER_PORT });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Herunterfahren', { signal });
    scheduler.stop();
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(`✗ Worker-Start fehlgeschlagen: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
