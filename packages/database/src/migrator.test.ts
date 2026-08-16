import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadMigrations, migrationsDirectory } from './migrator.js';

/**
 * Tests der Migrationsverwaltung.
 *
 * Migrationen sind die einzige Quelle des Datenbankschemas. Fehler hier
 * (falsche Reihenfolge, nachträglich veränderte Datei) fallen sonst erst in
 * der Produktion auf.
 */
describe('Migrationen', () => {
  it('lädt alle SQL-Dateien in aufsteigender Reihenfolge', async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(9);

    const names = migrations.map((m) => m.name);
    expect([...names].sort()).toEqual(names);
    expect(names[0]).toBe('0001_extensions.sql');
  });

  it('verwendet durchgehend das nummerierte Namensschema', async () => {
    const migrations = await loadMigrations();
    for (const migration of migrations) {
      expect(migration.name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
  });

  it('vergibt fortlaufende, eindeutige Nummern', async () => {
    const migrations = await loadMigrations();
    const numbers = migrations.map((m) => Number(m.name.slice(0, 4)));
    expect(new Set(numbers).size).toBe(numbers.length);
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i]!).toBe(numbers[i - 1]! + 1);
    }
  });

  it('berechnet stabile SHA-256-Prüfsummen über den Dateiinhalt', async () => {
    const migrations = await loadMigrations();
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(migration.checksum).toBe(
        createHash('sha256').update(migration.sql).digest('hex'),
      );
    }
  });

  it('enthält keine leeren Migrationen', async () => {
    const migrations = await loadMigrations();
    for (const migration of migrations) {
      expect(migration.sql.trim().length).toBeGreaterThan(0);
    }
  });

  it('legt PostGIS und die Suchhilfen zuerst an', async () => {
    const migrations = await loadMigrations();
    const first = migrations[0]!;
    expect(first.sql).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
    expect(first.sql).toContain('pg_trgm');
  });

  it('aktiviert Row Level Security auf allen Community-Tabellen', async () => {
    const migrations = await loadMigrations();
    const rls = migrations.find((m) => m.name.includes('rls'));
    expect(rls).toBeDefined();
    for (const table of [
      'public.profiles',
      'public.reports',
      'public.report_votes',
      'public.trip_sessions',
      'public.favorites',
      'public.admin_audit_logs',
    ]) {
      expect(rls!.sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it('vergibt keine Schreibrechte auf Meldungen an Client-Rollen', async () => {
    const migrations = await loadMigrations();
    const rls = migrations.find((m) => m.name.includes('rls'))!;
    // Schreibzugriffe laufen ausschliesslich über die API (Missbrauchsschutz),
    // deshalb darf es keine INSERT/UPDATE-Policy auf reports geben.
    expect(rls.sql).not.toMatch(/CREATE POLICY[^;]*ON public\.reports\s+FOR INSERT/i);
    expect(rls.sql).not.toMatch(/CREATE POLICY[^;]*ON public\.reports\s+FOR UPDATE/i);
    expect(rls.sql).not.toMatch(/CREATE POLICY[^;]*ON public\.reports\s+FOR ALL/i);
  });

  it('findet das Migrationsverzeichnis relativ zum Modul', () => {
    expect(migrationsDirectory()).toMatch(/migrations$/);
  });
});
