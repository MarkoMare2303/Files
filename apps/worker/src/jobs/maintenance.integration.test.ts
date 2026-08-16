import { randomUUID } from 'node:crypto';
import { loadEnvFiles } from '@swissov/config';
import { createDatabase, migrate, seed, type Database } from '@swissov/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';
import { createExpiryJob, createRetentionJob, createSessionCleanupJob } from './maintenance.job.js';
import { recomputeTrustScore } from '../trust.js';

/**
 * Integrationstests der Wartungsjobs gegen eine echte Datenbank (§48).
 */
describe('Wartungsjobs', () => {
  let db: Database;
  const logger = createLogger('error');
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    loadEnvFiles();
    const connectionString =
      process.env.TEST_DATABASE_URL ??
      'postgresql://swissov:swissov@127.0.0.1:5432/swissov_test';
    db = createDatabase({ connectionString, max: 3, applicationName: 'swissov-worker-test' });
    await migrate(db);
    await seed(db);

    userId = randomUUID();
    await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [
      userId,
      `${userId}@worker.test`,
    ]);
    await db.query('INSERT INTO public.profiles (id, alias) VALUES ($1, $2)', [
      userId,
      'Test Melder 1',
    ]);

    const category = await db.queryOne<{ id: string }>(
      `SELECT id FROM public.report_categories WHERE key = 'high_occupancy'`,
    );
    categoryId = category!.id;
  });

  afterAll(async () => {
    await db.query('DELETE FROM public.reports WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM public.profiles WHERE id = $1', [userId]);
    await db.query('DELETE FROM auth.users WHERE id = $1', [userId]);
    await db.close();
  });

  async function insertReport(options: {
    createdMinutesAgo: number;
    expiresMinutesAgo: number;
    status?: string;
    upvotes?: number;
    downvotes?: number;
  }): Promise<string> {
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO public.reports
         (user_id, category_id, scope, status, stop_id, expires_at, created_at, upvotes, downvotes)
       VALUES ($1, $2, 'STATION', $3::public.report_status, '8503000',
               now() - make_interval(mins => $4), now() - make_interval(mins => $5), $6, $7)
       RETURNING id`,
      [
        userId,
        categoryId,
        options.status ?? 'ACTIVE',
        options.expiresMinutesAgo,
        options.createdMinutesAgo,
        options.upvotes ?? 0,
        options.downvotes ?? 0,
      ],
    );
    return row!.id;
  }

  it('beendet abgelaufene Meldungen', async () => {
    const expired = await insertReport({ createdMinutesAgo: 60, expiresMinutesAgo: 5 });
    const stillValid = await db.queryOne<{ id: string }>(
      `INSERT INTO public.reports (user_id, category_id, scope, status, stop_id, expires_at)
       VALUES ($1, $2, 'STATION', 'ACTIVE', '8503000', now() + interval '30 minutes')
       RETURNING id`,
      [userId, categoryId],
    );

    await createExpiryJob(db, logger)();

    const after = await db.query<{ id: string; status: string }>(
      'SELECT id, status::text AS status FROM public.reports WHERE id = ANY ($1::uuid[])',
      [`{${expired},${stillValid!.id}}`],
    );
    const byId = new Map(after.rows.map((r) => [r.id, r.status]));
    expect(byId.get(expired)).toBe('EXPIRED');
    expect(byId.get(stillValid!.id)).toBe('ACTIVE');
  });

  it('beendet auch ungeprüfte Meldungen in der Moderations-Queue', async () => {
    const pending = await insertReport({
      createdMinutesAgo: 300,
      expiresMinutesAgo: 60,
      status: 'PENDING_REVIEW',
    });
    await createExpiryJob(db, logger)();
    const row = await db.queryOne<{ status: string }>(
      'SELECT status::text AS status FROM public.reports WHERE id = $1',
      [pending],
    );
    expect(row?.status).toBe('EXPIRED');
  });

  it('beendet verwaiste Fahrt-Sitzungen und löscht deren Position', async () => {
    const session = await db.queryOne<{ id: string }>(
      `INSERT INTO public.trip_sessions
         (user_id, trip_id, service_date, confidence, detection_method, started_at, last_seen_at, last_position)
       VALUES ($1, 'stale-trip', current_date, 0.9, 'AUTO_GPS',
               now() - interval '5 hours', now() - interval '4 hours',
               ST_SetSRID(ST_MakePoint(8.54, 47.37), 4326)::geography)
       RETURNING id`,
      [userId],
    );

    await createSessionCleanupJob(db, logger)();

    const row = await db.queryOne<{ ended_at: Date | null; last_position: unknown }>(
      'SELECT ended_at, last_position FROM public.trip_sessions WHERE id = $1',
      [session!.id],
    );
    expect(row?.ended_at).not.toBeNull();
    // Datenschutz: keine Bewegungshistorie nach Sitzungsende (§23).
    expect(row?.last_position).toBeNull();

    await db.query('DELETE FROM public.trip_sessions WHERE id = $1', [session!.id]);
  });

  it('löscht Daten nach Ablauf der Aufbewahrungsfrist', async () => {
    const old = await db.queryOne<{ id: string }>(
      `INSERT INTO public.reports (user_id, category_id, scope, status, stop_id, created_at, expires_at)
       VALUES ($1, $2, 'STATION', 'EXPIRED', '8503000',
               now() - interval '200 days', now() - interval '199 days')
       RETURNING id`,
      [userId, categoryId],
    );

    await createRetentionJob(db, logger)();

    const remaining = await db.queryOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.reports WHERE id = $1',
      [old!.id],
    );
    expect(remaining?.count).toBe(0);
  });

  it('lässt das Audit-Log nach dem Aufräumen wieder geschützt zurück', async () => {
    await createRetentionJob(db, logger)();
    // Der append-only-Trigger muss nach dem Retention-Lauf wieder aktiv sein.
    await db.query(
      `INSERT INTO public.admin_audit_logs (action, entity_type, entity_id)
       VALUES ('test.probe', 'test', 'probe')`,
    );
    await expect(
      db.query(`UPDATE public.admin_audit_logs SET action = 'x' WHERE entity_id = 'probe'`),
    ).rejects.toThrow(/append-only/);
    await db.query('ALTER TABLE public.admin_audit_logs DISABLE TRIGGER admin_audit_logs_no_update');
    await db.query(`DELETE FROM public.admin_audit_logs WHERE entity_id = 'probe'`);
    await db.query('ALTER TABLE public.admin_audit_logs ENABLE TRIGGER admin_audit_logs_no_update');
  });

  it('berechnet den Trust Score neu und beendet widerlegte Meldungen', async () => {
    const disputed = await insertReport({
      createdMinutesAgo: 10,
      expiresMinutesAgo: -60,
      upvotes: 1,
      downvotes: 6,
    });

    const confidence = await recomputeTrustScore(db, disputed);
    expect(confidence).not.toBeNull();

    const row = await db.queryOne<{ status: string; confidence: number }>(
      'SELECT status::text AS status, confidence FROM public.reports WHERE id = $1',
      [disputed],
    );
    // Klare Mehrheit an Gegenstimmen beendet die Meldung (§18).
    expect(row?.status).toBe('EXPIRED');
    expect(row?.confidence).toBeLessThan(40);
  });
});
