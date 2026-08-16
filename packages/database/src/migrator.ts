import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './client.js';

/**
 * Migrations-Runner.
 *
 * Bewusst minimal und ohne ORM: Migrationen sind reine `.sql`-Dateien, werden
 * in lexikografischer Reihenfolge angewendet und mit ihrer SHA-256-Prüfsumme
 * protokolliert. Eine nachträglich veränderte, bereits angewendete Migration
 * führt zu einem harten Fehler — das verhindert auseinanderlaufende Umgebungen.
 */

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  applied_at: Date;
}

export function migrationsDirectory(): string {
  // Funktioniert sowohl aus src/ (tsx) als auch aus dist/ (kompiliert).
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'migrations');
}

export async function loadMigrations(directory = migrationsDirectory()): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(directory, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    duration_ms integer NOT NULL DEFAULT 0
  )
`;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(
  db: Database,
  options: { directory?: string; log?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined);
  const migrations = await loadMigrations(options.directory);

  await db.query(MIGRATIONS_TABLE);

  const { rows: applied } = await db.query<AppliedMigration>(
    'SELECT name, checksum, applied_at FROM public.schema_migrations',
  );
  const appliedByName = new Map(applied.map((row) => [row.name, row]));

  const result: MigrateResult = { applied: [], skipped: [] };

  for (const migration of migrations) {
    const previous = appliedByName.get(migration.name);
    if (previous) {
      if (previous.checksum !== migration.checksum) {
        throw new Error(
          `Migration "${migration.name}" wurde nach der Anwendung verändert.\n` +
            `  erwartet: ${previous.checksum}\n  gefunden: ${migration.checksum}\n` +
            'Bereits angewendete Migrationen dürfen nicht editiert werden — bitte eine neue Migration anlegen.',
        );
      }
      result.skipped.push(migration.name);
      continue;
    }

    const started = Date.now();
    log(`→ wende an: ${migration.name}`);
    // Jede Migration läuft in einer eigenen Transaktion: entweder vollständig
    // oder gar nicht.
    await db.transaction(async (tx) => {
      await tx.query(migration.sql);
      await tx.query(
        'INSERT INTO public.schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
        [migration.name, migration.checksum, Date.now() - started],
      );
    });
    log(`  ✓ ${migration.name} (${Date.now() - started} ms)`);
    result.applied.push(migration.name);
  }

  return result;
}

export interface MigrationStatus {
  name: string;
  applied: boolean;
  appliedAt: Date | null;
  checksumMatches: boolean;
}

export async function status(
  db: Database,
  options: { directory?: string } = {},
): Promise<MigrationStatus[]> {
  const migrations = await loadMigrations(options.directory);
  await db.query(MIGRATIONS_TABLE);
  const { rows } = await db.query<AppliedMigration>(
    'SELECT name, checksum, applied_at FROM public.schema_migrations',
  );
  const byName = new Map(rows.map((row) => [row.name, row]));

  return migrations.map((migration) => {
    const applied = byName.get(migration.name);
    return {
      name: migration.name,
      applied: Boolean(applied),
      appliedAt: applied?.applied_at ?? null,
      checksumMatches: applied ? applied.checksum === migration.checksum : true,
    };
  });
}

/**
 * Verwirft das gesamte Schema. Ausschliesslich für lokale Entwicklung und
 * Integrationstests; in Produktion durch eine Sicherheitsabfrage geschützt.
 */
export async function reset(db: Database, options: { force?: boolean } = {}): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !options.force) {
    throw new Error('reset ist in Produktion gesperrt. Mit force: true bewusst überschreiben.');
  }
  await db.query('DROP SCHEMA IF EXISTS transit CASCADE');
  await db.query('DROP SCHEMA IF EXISTS public CASCADE');
  await db.query('CREATE SCHEMA public');
  // Auth-Shim nur lokal entfernen — auf Supabase existiert dort echtes Auth.
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'encrypted_password'
     ) AS exists`,
  );
  const isRealSupabaseAuth = rows[0]?.exists ?? false;
  if (!isRealSupabaseAuth) {
    await db.query('DROP SCHEMA IF EXISTS auth CASCADE');
  }
}
