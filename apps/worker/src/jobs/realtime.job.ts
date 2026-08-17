import { TRANSIT_KEY_VARIABLES, type WorkerEnv, resolveTransitApiKeys } from '@swissov/config';
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
 * Die beiden Feeds sind bei opentransportdata.swiss GETRENNTE Dienste mit
 * eigenen Tokens (GTFS-RT für Verspätungen, GTFS-SA für Störungsmeldungen).
 * Deshalb prüft jeder Job seinen eigenen Schlüssel: fehlt einer, fällt genau
 * dieser Feed aus, der andere läuft weiter.
 *
 * Fehlt ein Schlüssel, protokolliert der Job einmalig eine verständliche
 * Warnung und beendet sich, statt bei jedem Lauf Fehler zu erzeugen. Der
 * Zustand steht im Health-Endpunkt und im Admin-Dashboard.
 */
export function createTripUpdatesJob(
  db: Database,
  env: WorkerEnv,
  logger: Logger,
): () => Promise<void> {
  let warned = false;
  const apiKey = resolveTransitApiKeys(env).gtfsRt;

  return async () => {
    if (!apiKey) {
      if (!warned) {
        warned = true;
        logger.warn(
          `GTFS-RT deaktiviert: ${TRANSIT_KEY_VARIABLES.gtfsRt} fehlt. Verspätungen und Ausfälle ` +
            'werden nicht angezeigt. Kostenloses Token: https://opentransportdata.swiss/de/register/',
        );
        await recordFeedHealth(db, 'gtfs_rt_trip_updates', {
          ok: false,
          error: `${TRANSIT_KEY_VARIABLES.gtfsRt} nicht konfiguriert`,
        });
      }
      return;
    }

    try {
      const started = Date.now();
      const feed = await fetchFeedMessage({
        url: env.GTFS_RT_TRIP_UPDATES_URL,
        apiKey,
        authScheme: env.OPENTRANSPORTDATA_AUTH_SCHEME,
        credentialVariable: TRANSIT_KEY_VARIABLES.gtfsRt,
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
  const apiKey = resolveTransitApiKeys(env).gtfsSa;

  return async () => {
    if (!apiKey) {
      if (!warned) {
        warned = true;
        logger.warn(
          `Offizielle Störungsmeldungen deaktiviert: ${TRANSIT_KEY_VARIABLES.gtfsSa} fehlt.`,
        );
        await recordFeedHealth(db, 'service_alerts', {
          ok: false,
          error: `${TRANSIT_KEY_VARIABLES.gtfsSa} nicht konfiguriert`,
        });
      }
      return;
    }

    try {
      const started = Date.now();
      const feed = await fetchFeedMessage({
        url: env.GTFS_RT_SERVICE_ALERTS_URL,
        apiKey,
        authScheme: env.OPENTRANSPORTDATA_AUTH_SCHEME,
        credentialVariable: TRANSIT_KEY_VARIABLES.gtfsSa,
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
