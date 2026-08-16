import { apiEnvSchema, detectMissingIntegrations, loadEnvFiles, parseEnv } from '@swissov/config';
import { createDatabase } from '@swissov/database';
import { createContext } from './context.js';
import { createCache } from './lib/cache.js';
import { createErrorTracker } from './lib/observability.js';
import { buildServer } from './server.js';

/**
 * Einstiegspunkt des API-Servers.
 *
 * Beim Start wird sichtbar gemeldet, welche optionalen Integrationen mangels
 * Credentials inaktiv sind — statt später mit unklaren Fehlern aufzufallen (§55).
 */
async function main(): Promise<void> {
  loadEnvFiles();
  const env = parseEnv(apiEnvSchema);

  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    applicationName: 'swissov-api',
  });
  const cache = createCache(env.REDIS_URL);
  const errors = createErrorTracker(env.SENTRY_DSN);

  const context = await createContext({ env, db, cache, errors });
  const server = await buildServer({ context });

  const missing = detectMissingIntegrations(env);
  if (missing.length > 0) {
    server.log.warn(
      `Optionale Integrationen ohne Konfiguration:\n  • ${missing.join('\n  • ')}\n` +
        'Details siehe .env.example und IMPLEMENTATION_STATUS.md.',
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    server.log.info(`${signal} empfangen — fahre herunter …`);
    try {
      await server.close();
      await cache.close();
      await db.close();
      process.exit(0);
    } catch (error) {
      server.log.error({ err: error }, 'Fehler beim Herunterfahren');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await server.listen({ port: env.API_PORT, host: env.API_HOST });
  server.log.info(
    `API bereit auf http://${env.API_HOST}:${env.API_PORT}` +
      (env.NODE_ENV !== 'production' ? ` — Dokumentation: ${env.API_PUBLIC_URL}/docs` : ''),
  );
}

main().catch((error) => {
  console.error(`✗ Start fehlgeschlagen: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
