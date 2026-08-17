import type { WorkerEnv } from '@swissov/config';
import type { Database } from '@swissov/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests der GTFS-Realtime-Jobs — Schwerpunkt: die Zuordnung der Zugangsdaten.
 *
 * opentransportdata.swiss vergibt Tokens pro registrierter Anwendung, nicht
 * pro Konto: GTFS-RT (Verspätungen) und GTFS-SA (Störungsmeldungen) sind zwei
 * getrennte Dienste mit zwei getrennten Schlüsseln. Vertauscht man sie,
 * antwortet das Portal mit 401/403 — ununterscheidbar von einem abgelaufenen
 * Schlüssel, und der Betreiber sucht den Fehler an der falschen Stelle.
 *
 * Genau diese Verwechslung war im Code angelegt: beide Jobs benutzten
 * dieselbe Variable. Ohne Test fällt so etwas erst im Produktivbetrieb auf.
 */
const fetchFeedMessage = vi.fn();
const syncTripUpdates = vi.fn();
const syncServiceAlerts = vi.fn();
const recordFeedHealth = vi.fn();

vi.mock('@swissov/transit', () => ({
  MissingCredentialsError: class extends Error {},
  fetchFeedMessage: (...args: unknown[]) => fetchFeedMessage(...args),
  syncTripUpdates: (...args: unknown[]) => syncTripUpdates(...args),
  syncServiceAlerts: (...args: unknown[]) => syncServiceAlerts(...args),
  recordFeedHealth: (...args: unknown[]) => recordFeedHealth(...args),
}));

const { createServiceAlertsJob, createTripUpdatesJob } = await import('./realtime.job.js');

const db = {} as Database;
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => logger,
} as unknown as Parameters<typeof createTripUpdatesJob>[2];

function env(overrides: Partial<WorkerEnv>): WorkerEnv {
  return {
    GTFS_RT_TRIP_UPDATES_URL: 'https://api.example/gtfsrt',
    GTFS_RT_SERVICE_ALERTS_URL: 'https://api.example/gtfssa',
    ...overrides,
  } as WorkerEnv;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFeedMessage.mockResolvedValue({});
  syncTripUpdates.mockResolvedValue({ tripUpdates: 1, stopTimeUpdates: 2, cancelled: 0 });
  syncServiceAlerts.mockResolvedValue({ alerts: 1, entities: 1, removed: 0 });
  recordFeedHealth.mockResolvedValue(undefined);
});

describe('Zuordnung der Zugangsdaten', () => {
  it('sendet an jeden Feed dessen eigenes Token', async () => {
    const configured = env({
      OPENTRANSPORTDATA_GTFS_RT_API_KEY: 'rt-token',
      OPENTRANSPORTDATA_GTFS_SA_API_KEY: 'sa-token',
    });

    await createTripUpdatesJob(db, configured, logger)();
    expect(fetchFeedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example/gtfsrt', apiKey: 'rt-token' }),
    );

    fetchFeedMessage.mockClear();
    await createServiceAlertsJob(db, configured, logger)();
    expect(fetchFeedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example/gtfssa', apiKey: 'sa-token' }),
    );
  });

  it('reicht das konfigurierte Authentifizierungsverfahren durch', async () => {
    // War vorher nicht der Fall: `OPENTRANSPORTDATA_AUTH_SCHEME` stand in der
    // Dokumentation, kam im Worker aber nie an — die Fallback-Anfragen liefen
    // trotzdem bei jedem Abruf.
    await createTripUpdatesJob(
      db,
      env({ OPENTRANSPORTDATA_GTFS_RT_API_KEY: 'rt-token', OPENTRANSPORTDATA_AUTH_SCHEME: 'raw' }),
      logger,
    )();
    expect(fetchFeedMessage).toHaveBeenCalledWith(expect.objectContaining({ authScheme: 'raw' }));
  });

  it('nutzt den generischen Schlüssel, wo kein dienstspezifischer gesetzt ist', async () => {
    const configured = env({
      OPENTRANSPORTDATA_API_KEY: 'generisch',
      OPENTRANSPORTDATA_GTFS_RT_API_KEY: 'rt-token',
    });

    await createTripUpdatesJob(db, configured, logger)();
    expect(fetchFeedMessage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'rt-token' }));

    fetchFeedMessage.mockClear();
    await createServiceAlertsJob(db, configured, logger)();
    expect(fetchFeedMessage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'generisch' }));
  });
});

describe('fehlende Zugangsdaten', () => {
  it('legt nur den betroffenen Feed still, nicht beide', async () => {
    // Nur GTFS-SA fehlt: Verspätungen müssen weiterhin abgerufen werden.
    const configured = env({ OPENTRANSPORTDATA_GTFS_RT_API_KEY: 'rt-token' });

    await createTripUpdatesJob(db, configured, logger)();
    expect(fetchFeedMessage).toHaveBeenCalledTimes(1);

    fetchFeedMessage.mockClear();
    await createServiceAlertsJob(db, configured, logger)();
    expect(fetchFeedMessage).not.toHaveBeenCalled();
  });

  it('nennt die Variable, die wirklich fehlt', async () => {
    // Ein pauschaler Verweis auf OPENTRANSPORTDATA_API_KEY schickt den
    // Betreiber zur falschen Zeile in der .env.
    await createServiceAlertsJob(db, env({ OPENTRANSPORTDATA_GTFS_RT_API_KEY: 'rt' }), logger)();

    expect(recordFeedHealth).toHaveBeenCalledWith(
      db,
      'service_alerts',
      expect.objectContaining({ ok: false, error: expect.stringContaining('GTFS_SA') }),
    );
  });

  it('warnt nur einmal, nicht bei jedem Lauf', async () => {
    const job = createServiceAlertsJob(db, env({}), logger);
    await job();
    await job();
    await job();
    expect(recordFeedHealth).toHaveBeenCalledTimes(1);
  });
});
