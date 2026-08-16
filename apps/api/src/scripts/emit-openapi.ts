#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { apiEnvSchema, loadEnvFiles, parseEnv } from '@swissov/config';
import { createDatabase } from '@swissov/database';
import { createContext } from '../context.js';
import { MemoryCache } from '../lib/cache.js';
import { noopErrorTracker } from '../lib/observability.js';
import { buildServer } from '../server.js';

/**
 * Schreibt die OpenAPI-Spezifikation als Datei.
 *
 *   pnpm --filter @swissov/api run openapi [ziel.json]
 *
 * Nützlich, um API-Clients zu generieren oder Änderungen am Vertrag im
 * Review sichtbar zu machen. Der Server wird dafür aufgebaut, aber nie
 * gestartet — eine Datenbankverbindung wird nur für den Kontext geöffnet.
 */
async function main(): Promise<void> {
  loadEnvFiles();
  const env = parseEnv(apiEnvSchema);
  const target = resolve(process.argv[2] ?? 'openapi.json');

  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'swissov-openapi',
  });

  try {
    const context = await createContext({
      env,
      db,
      cache: new MemoryCache(),
      errors: noopErrorTracker,
    });
    const server = await buildServer({ context });
    await server.ready();

    const spec = server.swagger();
    await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

    const paths = Object.keys((spec as { paths?: Record<string, unknown> }).paths ?? {}).length;
    console.log(`✓ OpenAPI-Spezifikation geschrieben: ${target} (${paths} Pfade)`);

    await server.close();
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
