import type { Database } from '@swissov/database';
import { DEFAULT_RUNTIME_CONFIG, computeTrustScore, shouldAutoExpire } from '@swissov/shared';
import { runtimeConfigSchema } from '@swissov/types';

/**
 * Neuberechnung des Trust Scores im Worker (§19).
 *
 * Bewusst eine eigenständige Funktion statt eines Imports aus der API: Worker
 * und API sind getrennt deploybar. Die fachliche Logik selbst liegt in
 * `@swissov/shared` und ist damit für beide identisch.
 */
interface TrustRow {
  id: string;
  upvotes: number;
  downvotes: number;
  flags_count: number;
  created_at: Date;
  gps_plausibility: number;
  trip_session_id: string | null;
  status: string;
  author_reputation: number;
  session_confidence: number | null;
  recent_by_author: number;
}

async function loadConfig(db: Database): Promise<{
  trust: typeof DEFAULT_RUNTIME_CONFIG.trust;
  moderation: typeof DEFAULT_RUNTIME_CONFIG.moderation;
}> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM public.app_config WHERE key IN ('trust', 'moderation')`,
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const trust = runtimeConfigSchema.shape.trust.safeParse(byKey.get('trust'));
  const moderation = runtimeConfigSchema.shape.moderation.safeParse(byKey.get('moderation'));

  return {
    trust: trust.success ? trust.data : DEFAULT_RUNTIME_CONFIG.trust,
    moderation: moderation.success ? moderation.data : DEFAULT_RUNTIME_CONFIG.moderation,
  };
}

export async function recomputeTrustScore(db: Database, reportId: string): Promise<number | null> {
  const config = await loadConfig(db);

  const row = await db.queryOne<TrustRow>(
    `SELECT r.id, r.upvotes, r.downvotes, r.flags_count, r.created_at, r.gps_plausibility,
            r.trip_session_id, r.status::text AS status,
            p.reputation_score AS author_reputation,
            ts.confidence AS session_confidence,
            (SELECT count(*)::int FROM public.reports r2
              WHERE r2.user_id = r.user_id AND r2.created_at > now() - interval '1 hour') AS recent_by_author
     FROM public.reports r
     JOIN public.profiles p ON p.id = r.user_id
     LEFT JOIN public.trip_sessions ts ON ts.id = r.trip_session_id
     WHERE r.id = $1`,
    [reportId],
  );
  if (!row) return null;

  const confidence = computeTrustScore(
    {
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      createdAt: row.created_at,
      authorReputation: row.author_reputation,
      hadTripSession: row.trip_session_id !== null,
      tripSessionConfidence: row.session_confidence === null ? null : Number(row.session_confidence),
      gpsPlausibility: Number(row.gps_plausibility),
      flagsCount: row.flags_count,
      recentReportsByAuthor: row.recent_by_author,
    },
    config.trust,
  );

  const expire =
    row.status === 'ACTIVE' &&
    shouldAutoExpire({ upvotes: row.upvotes, downvotes: row.downvotes }, config.moderation);

  await db.query(
    `UPDATE public.reports
     SET confidence = $2,
         status = CASE WHEN $3::boolean THEN 'EXPIRED'::public.report_status ELSE status END
     WHERE id = $1`,
    [reportId, confidence, expire],
  );

  return confidence;
}
