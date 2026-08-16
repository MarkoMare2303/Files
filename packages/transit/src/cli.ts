#!/usr/bin/env node
import { loadEnvFiles, parseEnv, transitEnvSchema } from '@swissov/config';
import { createDatabase } from '@swissov/database';
import { z } from 'zod';
import { importGtfsStatic } from './gtfs/importer.js';

/**
 * GTFS-Import von der Kommandozeile:
 *
 *   pnpm gtfs:import                          Standardquelle aus GTFS_STATIC_URL
 *   pnpm gtfs:import --url <URL>              abweichende Quelle
 *   pnpm gtfs:import --force                  auch bei unveränderter Prüfsumme
 *   pnpm gtfs:import --rows 50000             nur die ersten N Zeilen je Datei
 */

const envSchema = transitEnvSchema.extend({ DATABASE_URL: z.string().url() });

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  loadEnvFiles();
  const env = parseEnv(envSchema);

  const url = argValue('--url') ?? env.GTFS_STATIC_URL;
  const force = process.argv.includes('--force');
  const rowsArg = argValue('--rows');
  const rowLimit = rowsArg ? Number.parseInt(rowsArg, 10) : undefined;

  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    max: 4,
    applicationName: 'swissov-gtfs-import',
    // Der Import führt sehr lange laufende Statements aus (COPY, UPDATE, ANALYZE).
    statementTimeoutMs: 3_600_000,
  });

  try {
    const result = await importGtfsStatic(db, {
      url,
      apiKey: env.OPENTRANSPORTDATA_API_KEY,
      force,
      log: (message) => console.log(message),
      ...(rowLimit && Number.isFinite(rowLimit) ? { rowLimit } : {}),
    });
    console.log(
      result.status === 'UNCHANGED'
        ? '✓ Feed war bereits aktuell.'
        : `✓ Import abgeschlossen (Feed ${result.feedId}).`,
    );
  } catch (error) {
    console.error(`✗ Import fehlgeschlagen: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

void main();
