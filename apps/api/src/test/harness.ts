import { randomUUID } from 'node:crypto';
import { apiEnvSchema, loadEnvFiles, parseEnv } from '@swissov/config';
import { createDatabase, migrate, seed, type Database } from '@swissov/database';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { createContext, type AppContext } from '../context.js';
import { MemoryCache } from '../lib/cache.js';
import { noopErrorTracker } from '../lib/observability.js';
import { buildServer } from '../server.js';
import { clearTestFeeds, seedTestFeed, type TestFeed } from './fixtures.js';

/**
 * Testumgebung für Integrationstests.
 *
 * Läuft gegen eine echte PostgreSQL/PostGIS-Datenbank (TEST_DATABASE_URL) —
 * die Geo-Abfragen und SQL-Funktionen sind der Kern der Anwendung und lassen
 * sich nicht sinnvoll mocken.
 */
const TEST_JWT_SECRET = 'test-secret-für-integrationstests-mindestens-32-zeichen';

export interface TestHarness {
  server: FastifyInstance;
  db: Database;
  ctx: AppContext;
  feed: TestFeed;
  /** Erzeugt einen Nutzer und liefert ein gültiges Bearer-Token. */
  createUser(options?: { role?: 'USER' | 'MODERATOR' | 'ADMIN' }): Promise<TestUser>;
  /**
   * Erzeugt einen Nutzer ausschliesslich über `ProfileService.ensure()` — also
   * auf demselben Weg wie der erste echte Login, ohne dass der Test vorher
   * selbst in `auth.users` schreibt.
   */
  createUserViaEnsure(): Promise<{ id: string }>;
  close(): Promise<void>;
}

export interface TestUser {
  id: string;
  token: string;
  authHeader: { authorization: string };
}

export interface HarnessOptions {
  now?: Date;
  /**
   * Überschreibt einzelne Umgebungswerte.
   *
   * Gedacht für die Betriebsart „eigene PostgreSQL + Supabase nur für die
   * Anmeldung": dort ist `SUPABASE_URL` gesetzt, das `auth`-Schema aber der
   * lokale Shim aus Migration 0002. Diese Kombination verhält sich anders als
   * beide Reinformen und liess sich vorher nicht testen.
   */
  env?: Record<string, string>;
}

export async function createHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  loadEnvFiles();

  const connectionString =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://swissov:swissov@127.0.0.1:5432/swissov_test';

  const env = parseEnv(apiEnvSchema, {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: connectionString,
    API_INTERNAL_SECRET: 'integration-test-secret-value-32chars',
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
    // Redis bewusst nicht verwenden: Tests sollen ohne externe Dienste laufen.
    REDIS_URL: '',
    API_CORS_ORIGINS: 'http://localhost:3000',
    // Externe Integrationen ausdrücklich abschalten. Ohne diese Zeilen hängt
    // das Testergebnis davon ab, was in der lokalen `.env` steht — ein Test,
    // der bei einem Entwickler grün und beim nächsten rot ist, prüft nichts.
    // Wer den aktivierten Zustand testen will, setzt die Werte im Test selbst.
    WEB_PUSH_VAPID_PUBLIC_KEY: '',
    WEB_PUSH_VAPID_PRIVATE_KEY: '',
    OPENTRANSPORTDATA_API_KEY: '',
    OJP_API_KEY: '',
    ...options.env,
  });

  const db = createDatabase({
    connectionString,
    max: 5,
    applicationName: 'swissov-api-test',
    statementTimeoutMs: 60_000,
  });

  await migrate(db);
  await seed(db);
  await resetData(db);

  const feed = await seedTestFeed(db, options.now);

  const ctx = await createContext({
    env,
    db,
    cache: new MemoryCache(),
    errors: noopErrorTracker,
  });

  const server = await buildServer({ context: ctx });
  await server.ready();

  const secret = new TextEncoder().encode(TEST_JWT_SECRET);

  return {
    server,
    db,
    ctx,
    feed,
    async createUser(userOptions = {}) {
      const id = randomUUID();
      // Das Auth-Konto existiert lokal nur als Stub (siehe Migration 0002).
      await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [
        id,
        `${id}@integration.test`,
      ]);
      const token = await new SignJWT({ sub: id, role: 'authenticated', email: `${id}@test.local` })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      // Profil anlegen (sonst entsteht es erst beim ersten Request).
      await ctx.profiles.ensure(id);
      if (userOptions.role && userOptions.role !== 'USER') {
        await db.query('UPDATE public.profiles SET role = $2::public.user_role WHERE id = $1', [
          id,
          userOptions.role,
        ]);
      }
      return { id, token, authHeader: { authorization: `Bearer ${token}` } };
    },
    async createUserViaEnsure() {
      const id = randomUUID();
      await ctx.profiles.ensure(id);
      return { id };
    },
    async close() {
      await server.close();
      await ctx.cache.close();
      await db.close();
    },
  };
}

/** Räumt Anwendungsdaten zwischen Testläufen auf; Stammdaten bleiben erhalten. */
export async function resetData(db: Database): Promise<void> {
  await db.query(`
    TRUNCATE
      public.notification_queue,
      public.abuse_signals,
      public.user_reputation_events,
      public.report_flags,
      public.report_votes,
      public.reports,
      public.trip_follows,
      public.trip_sessions,
      public.favorites,
      public.push_subscriptions,
      public.devices,
      public.user_settings,
      public.moderation_actions
    CASCADE
  `);
  // admin_audit_logs ist append-only (Trigger verhindert DELETE) — daher
  // wird die Tabelle mit TRUNCATE geleert, was den Trigger nicht auslöst.
  await db.query('TRUNCATE public.admin_audit_logs');
  await db.query('DELETE FROM public.profiles');
  await db.query('DELETE FROM auth.users');
  await clearTestFeeds(db);

  // Laufzeitkonfiguration und Feature-Flags auf die Seed-Werte zurücksetzen:
  // sonst schleppt ein Testlauf Änderungen des vorherigen mit sich.
  await db.query('DELETE FROM public.app_config');
  await db.query('DELETE FROM public.feature_flags');
  await seed(db);
}
