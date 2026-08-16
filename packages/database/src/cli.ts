#!/usr/bin/env node
import { loadEnvFiles, parseEnv } from '@swissov/config';
import { z } from 'zod';
import { createDatabase } from './client.js';
import { migrate, reset, status } from './migrator.js';
import { seed } from './seeds/index.js';

/**
 * CLI für Datenbankoperationen:
 *   pnpm db:migrate            Migrationen anwenden
 *   pnpm db:migrate:status     Status anzeigen
 *   pnpm db:seed               Stammdaten einspielen
 *   pnpm db:reset              Schema verwerfen, neu migrieren und seeden
 *
 * Mit `--test` wird TEST_DATABASE_URL statt DATABASE_URL verwendet.
 */

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().optional(),
});

function connectionString(useTest: boolean): string {
  loadEnvFiles();
  const env = parseEnv(envSchema);
  if (useTest) {
    if (!env.TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL ist nicht gesetzt (siehe .env.example).');
    }
    return env.TEST_DATABASE_URL;
  }
  return env.DATABASE_URL;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'migrate';
  const useTest = args.includes('--test');
  const force = args.includes('--force');

  const db = createDatabase({
    connectionString: connectionString(useTest),
    max: 2,
    applicationName: 'swissov-migrate',
    // Migrationen auf grossen Tabellen (Indexaufbau) brauchen mehr Zeit.
    statementTimeoutMs: 600_000,
  });

  try {
    switch (command) {
      case 'migrate': {
        const result = await migrate(db, { log: (m) => console.log(m) });
        console.log(
          result.applied.length > 0
            ? `✓ ${result.applied.length} Migration(en) angewendet, ${result.skipped.length} bereits vorhanden.`
            : `✓ Datenbank ist aktuell (${result.skipped.length} Migrationen).`,
        );
        break;
      }
      case 'status': {
        const rows = await status(db);
        for (const row of rows) {
          const mark = row.applied ? (row.checksumMatches ? '✓' : '!') : '·';
          const when = row.appliedAt ? row.appliedAt.toISOString() : 'ausstehend';
          console.log(`${mark} ${row.name.padEnd(32)} ${when}`);
        }
        if (rows.some((r) => !r.checksumMatches)) {
          console.error('\n! Mindestens eine angewendete Migration wurde nachträglich verändert.');
          process.exitCode = 1;
        }
        break;
      }
      case 'seed': {
        await seed(db, { log: (m) => console.log(m) });
        console.log('✓ Seeds eingespielt.');
        break;
      }
      case 'reset': {
        await reset(db, { force });
        console.log('✓ Schema verworfen.');
        await migrate(db, { log: (m) => console.log(m) });
        await seed(db, { log: (m) => console.log(m) });
        console.log('✓ Datenbank neu aufgebaut.');
        break;
      }
      default:
        console.error(`Unbekannter Befehl: ${command}`);
        console.error('Verfügbar: migrate | status | seed | reset [--test] [--force]');
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

void main();
