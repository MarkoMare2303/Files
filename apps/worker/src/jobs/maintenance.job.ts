import type { Database } from '@swissov/database';
import type { Logger } from '../logger.js';

/**
 * Wartungsjobs: Ablauf von Meldungen, Sitzungsende, Datenaufbewahrung.
 */

/** Beendet abgelaufene Meldungen (§17). */
export function createExpiryJob(db: Database, logger: Logger): () => Promise<void> {
  return async () => {
    const expired = await db.query(
      `UPDATE public.reports SET status = 'EXPIRED'
       WHERE status = 'ACTIVE' AND expires_at <= now()`,
    );

    // Meldungen in der Moderations-Queue, die nie geprüft wurden, laufen
    // ebenfalls ab — sie sollen nicht Wochen später plötzlich erscheinen.
    const stalePending = await db.query(
      `UPDATE public.reports SET status = 'EXPIRED'
       WHERE status = 'PENDING_REVIEW' AND expires_at <= now()`,
    );

    const follows = await db.query('DELETE FROM public.trip_follows WHERE expires_at < now()');

    if (expired.rowCount + stalePending.rowCount + follows.rowCount > 0) {
      logger.info('Ablauf verarbeitet', {
        expired: expired.rowCount,
        stalePending: stalePending.rowCount,
        followsRemoved: follows.rowCount,
      });
    }
  };
}

/** Beendet verwaiste Fahrt-Sitzungen und löscht deren Positionen (§23). */
export function createSessionCleanupJob(db: Database, logger: Logger): () => Promise<void> {
  return async () => {
    const result = await db.query(
      `UPDATE public.trip_sessions
       SET ended_at = now(), ended_reason = 'stale', last_position = NULL, following = false
       WHERE ended_at IS NULL
         AND (last_seen_at < now() - interval '2 hours' OR started_at < now() - interval '12 hours')`,
    );
    if (result.rowCount > 0) {
      logger.info('Verwaiste Fahrt-Sitzungen beendet', { sessions: result.rowCount });
    }
  };
}

/**
 * Aufbewahrungsfristen (§23).
 *
 * Die Werte sind bewusst konservativ und an einer Stelle dokumentiert; sie
 * gehören vor dem Launch juristisch geprüft (siehe docs/privacy-architecture.md).
 */
export const RETENTION = {
  /** Beendete Meldungen inkl. Position. */
  expiredReportsDays: 90,
  /** Beendete Fahrt-Sitzungen. */
  tripSessionsDays: 30,
  /** Missbrauchssignale. */
  abuseSignalsDays: 180,
  /** Reputationsereignisse (Einzelereignisse; der Punktestand bleibt). */
  reputationEventsDays: 365,
  /** Zugestellte oder verworfene Benachrichtigungen. */
  notificationsDays: 14,
  /** Audit-Log der Administration. */
  auditLogDays: 730,
  /** Nicht mehr genutzte Geräteeinträge. */
  inactiveDevicesDays: 180,
} as const;

export function createRetentionJob(db: Database, logger: Logger): () => Promise<void> {
  return async () => {
    const deletions: Record<string, number> = {};

    const run = async (label: string, sql: string, params: unknown[]): Promise<void> => {
      const result = await db.query(sql, params as never);
      if (result.rowCount > 0) deletions[label] = result.rowCount;
    };

    await run(
      'reports',
      `DELETE FROM public.reports
       WHERE status IN ('EXPIRED', 'REMOVED')
         AND created_at < now() - make_interval(days => $1)`,
      [RETENTION.expiredReportsDays],
    );
    await run(
      'tripSessions',
      `DELETE FROM public.trip_sessions
       WHERE ended_at IS NOT NULL AND ended_at < now() - make_interval(days => $1)`,
      [RETENTION.tripSessionsDays],
    );
    await run(
      'abuseSignals',
      `DELETE FROM public.abuse_signals WHERE created_at < now() - make_interval(days => $1)`,
      [RETENTION.abuseSignalsDays],
    );
    await run(
      'reputationEvents',
      `DELETE FROM public.user_reputation_events
       WHERE created_at < now() - make_interval(days => $1)`,
      [RETENTION.reputationEventsDays],
    );
    await run(
      'notifications',
      `DELETE FROM public.notification_queue
       WHERE status <> 'PENDING' AND created_at < now() - make_interval(days => $1)`,
      [RETENTION.notificationsDays],
    );
    await run(
      'devices',
      `DELETE FROM public.devices WHERE last_seen_at < now() - make_interval(days => $1)`,
      [RETENTION.inactiveDevicesDays],
    );
    // Audit-Log ist append-only; das Löschen alter Einträge erfolgt bewusst
    // ausserhalb des Triggers mit TRUNCATE-freier Einzellöschung.
    await db.query('ALTER TABLE public.admin_audit_logs DISABLE TRIGGER admin_audit_logs_no_update');
    try {
      await run(
        'auditLogs',
        `DELETE FROM public.admin_audit_logs WHERE created_at < now() - make_interval(days => $1)`,
        [RETENTION.auditLogDays],
      );
    } finally {
      await db.query('ALTER TABLE public.admin_audit_logs ENABLE TRIGGER admin_audit_logs_no_update');
    }

    if (Object.keys(deletions).length > 0) {
      logger.info('Aufbewahrungsfristen angewendet', deletions);
    }
  };
}

/** Aktualisiert die Confidence aktiver Meldungen (Alterung, §19). */
export function createTrustRefreshJob(
  db: Database,
  recompute: (reportId: string) => Promise<unknown>,
  logger: Logger,
): () => Promise<void> {
  return async () => {
    // Nur Meldungen, die tatsächlich Stimmen haben — bei allen anderen ändert
    // die Alterung nichts am Ergebnis.
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.reports
       WHERE status = 'ACTIVE' AND expires_at > now() AND (upvotes > 0 OR downvotes > 0)
       ORDER BY updated_at ASC
       LIMIT 500`,
    );
    for (const row of rows) {
      await recompute(row.id).catch(() => undefined);
    }
    if (rows.length > 0) logger.debug('Trust Scores aktualisiert', { reports: rows.length });
  };
}
