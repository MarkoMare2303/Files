import type { WorkerEnv } from '@swissov/config';
import type { Database } from '@swissov/database';
import {
  MissingCredentialsError,
  fetchFeedMessage,
  recordFeedHealth,
  syncServiceAlerts,
  syncTripUpdates,
} from '@swissov/transit';
import type { Logger } from '../logger.js';

/**
 * GTFS-Realtime-Jobs (§6/§7).
 *
 * Ohne `OPENTRANSPORTDATA_API_KEY` protokollieren die Jobs einmalig eine
 * verständliche Warnung und beenden sich, statt bei jedem Lauf Fehler zu
 * erzeugen. Der Zustand steht im Health-Endpunkt und im Admin-Dashboard.
 */
export function createTripUpdatesJob(
  db: Database,
  env: WorkerEnv,
  logger: Logger,
): () => Promise<void> {
  let warned = false;

  return async () => {
    if (!env.OPENTRANSPORTDATA_API_KEY) {
      if (!warned) {
        warned = true;
        logger.warn(
          'GTFS-RT deaktiviert: OPENTRANSPORTDATA_API_KEY fehlt. Verspätungen und Ausfälle ' +
            'werden nicht angezeigt. Kostenloses Token: https://opentransportdata.swiss/de/register/',
        );
        await recordFeedHealth(db, 'gtfs_rt_trip_updates', {
          ok: false,
          error: 'OPENTRANSPORTDATA_API_KEY nicht konfiguriert',
        });
      }
      return;
    }

    try {
      const started = Date.now();
      const feed = await fetchFeedMessage({
        url: env.GTFS_RT_TRIP_UPDATES_URL,
        apiKey: env.OPENTRANSPORTDATA_API_KEY,
      });
      const result = await syncTripUpdates(db, feed);
      const durationMs = Date.now() - started;

      logger.info('GTFS-RT Trip Updates synchronisiert', {
        tripUpdates: result.tripUpdates,
        stopTimeUpdates: result.stopTimeUpdates,
        cancelled: result.cancelled,
        durationMs,
      });

      await recordFeedHealth(db, 'gtfs_rt_trip_updates', {
        ok: true,
        metrics: {
          tripUpdates: result.tripUpdates,
          stopTimeUpdates: result.stopTimeUpdates,
          cancelled: result.cancelled,
          durationMs,
          feedTimestamp: result.feedTimestamp?.toISOString() ?? null,
        },
      });
    } catch (error) {
      const message =
        error instanceof MissingCredentialsError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      logger.error('GTFS-RT Trip Updates fehlgeschlagen', { error: message });
      await recordFeedHealth(db, 'gtfs_rt_trip_updates', { ok: false, error: message });
    }
  };
}

export function createServiceAlertsJob(
  db: Database,
  env: WorkerEnv,
  logger: Logger,
): () => Promise<void> {
  let warned = false;

  return async () => {
    if (!env.OPENTRANSPORTDATA_API_KEY) {
      if (!warned) {
        warned = true;
        logger.warn(
          'Offizielle Störungsmeldungen deaktiviert: OPENTRANSPORTDATA_API_KEY fehlt.',
        );
        await recordFeedHealth(db, 'service_alerts', {
          ok: false,
          error: 'OPENTRANSPORTDATA_API_KEY nicht konfiguriert',
        });
      }
      return;
    }

    try {
      const started = Date.now();
      const feed = await fetchFeedMessage({
        url: env.GTFS_RT_SERVICE_ALERTS_URL,
        apiKey: env.OPENTRANSPORTDATA_API_KEY,
      });
      const result = await syncServiceAlerts(db, feed);
      const durationMs = Date.now() - started;

      logger.info('Offizielle Störungsmeldungen synchronisiert', {
        alerts: result.alerts,
        entities: result.entities,
        removed: result.removed,
        durationMs,
      });

      await recordFeedHealth(db, 'service_alerts', {
        ok: true,
        metrics: { ...result, durationMs },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Störungsmeldungen fehlgeschlagen', { error: message });
      await recordFeedHealth(db, 'service_alerts', { ok: false, error: message });
    }
  };
}
