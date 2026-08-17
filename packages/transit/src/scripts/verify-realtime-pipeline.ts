#!/usr/bin/env node
import { createServer } from 'node:http';
import { loadEnvFiles, parseEnv, transitEnvSchema } from '@swissov/config';
import { createDatabase } from '@swissov/database';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { z } from 'zod';
import { fetchFeedMessage, recordFeedHealth, syncServiceAlerts, syncTripUpdates } from '../realtime/gtfs-rt.js';

/**
 * Prüft die GTFS-Realtime-Kette Ende zu Ende — ohne Netzzugang.
 *
 *     pnpm --filter @swissov/transit run verify:realtime
 *
 * Warum das nötig ist: Der Weg von „Protocol Buffers über HTTP" bis
 * „Verspätung steht in der Abfahrtstafel" hat viele Stellen, an denen etwas
 * schiefgehen kann — Authentifizierung, Dekodierung, Betriebstag-Auflösung,
 * Zuordnung zu importierten Fahrten. Diese Kette lässt sich nicht durch
 * Nachdenken prüfen.
 *
 * Das Skript erzeugt deshalb einen ECHTEN GTFS-RT-Feed (dieselbe Bibliothek,
 * die auch der Produktivcode zum Dekodieren nutzt), serviert ihn über einen
 * lokalen HTTP-Server und lässt den unveränderten Produktivpfad darauf los:
 * `fetchFeedMessage` → `syncTripUpdates` / `syncServiceAlerts`.
 *
 * Was NICHT geprüft wird: die Erreichbarkeit von opentransportdata.swiss und
 * die Form ihrer echten Feeds. Dafür gibt es `pnpm gtfs:verify-production`.
 */
const rt = GtfsRealtimeBindings.transit_realtime;
const envSchema = transitEnvSchema.extend({ DATABASE_URL: z.string().url() });

/** Baut einen Feed mit Verspätungen für echte, importierte Fahrten. */
function buildTripUpdateFeed(
  trips: Array<{ tripId: string; serviceDate: string; stopId: string; delaySeconds: number }>,
): Uint8Array {
  const now = Math.floor(Date.now() / 1000);
  const message = rt.FeedMessage.create({
    header: {
      gtfsRealtimeVersion: '2.0',
      incrementality: rt.FeedHeader.Incrementality.FULL_DATASET,
      timestamp: now,
    },
    entity: trips.map((trip, index) => ({
      id: `tu-${index}`,
      tripUpdate: {
        trip: {
          tripId: trip.tripId,
          // Betriebstag im GTFS-Format; genau so liefert es der Schweizer Feed.
          startDate: trip.serviceDate.replaceAll('-', ''),
          scheduleRelationship: rt.TripDescriptor.ScheduleRelationship.SCHEDULED,
        },
        stopTimeUpdate: [
          {
            stopId: trip.stopId,
            arrival: { delay: trip.delaySeconds },
            departure: { delay: trip.delaySeconds },
            scheduleRelationship: rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED,
          },
        ],
        timestamp: now,
        delay: trip.delaySeconds,
      },
    })),
  });
  return rt.FeedMessage.encode(message).finish();
}

/** Baut einen Feed mit einer offiziellen Störungsmeldung. */
function buildAlertFeed(routeId: string, stopId: string): Uint8Array {
  const now = Math.floor(Date.now() / 1000);
  const message = rt.FeedMessage.create({
    header: { gtfsRealtimeVersion: '2.0', timestamp: now },
    entity: [
      {
        id: 'alert-verify-1',
        alert: {
          activePeriod: [{ start: now - 600, end: now + 3600 }],
          informedEntity: [{ routeId }, { stopId }],
          cause: rt.Alert.Cause.TECHNICAL_PROBLEM,
          effect: rt.Alert.Effect.SIGNIFICANT_DELAYS,
          headerText: {
            translation: [
              { language: 'de', text: 'Technische Störung — Verspätungen' },
              { language: 'fr', text: 'Panne technique — retards' },
            ],
          },
          descriptionText: {
            translation: [
              { language: 'de', text: 'Wegen einer technischen Störung verkehren die Züge verspätet.' },
            ],
          },
          severityLevel: rt.Alert.SeverityLevel.WARNING,
        },
      },
    ],
  });
  return rt.FeedMessage.encode(message).finish();
}

async function main(): Promise<void> {
  loadEnvFiles();
  const env = parseEnv(envSchema);
  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    max: 2,
    applicationName: 'swissov-verify-realtime',
  });

  try {
    // --- Echte, importierte Fahrten als Grundlage --------------------------
    const { rows: trips } = await db.query<{
      trip_id: string;
      service_date: string;
      stop_id: string;
      route_id: string;
    }>(
      `WITH f AS (SELECT transit.active_feed_id() AS id)
       SELECT t.trip_id,
              (now() AT TIME ZONE 'Europe/Zurich')::date::text AS service_date,
              st.stop_id,
              t.route_id
       FROM transit.trips t
       CROSS JOIN f
       JOIN transit.stop_times st
         ON st.feed_id = f.id AND st.trip_id = t.trip_id AND st.stop_sequence = 1
       WHERE t.feed_id = f.id
       ORDER BY t.trip_id
       LIMIT 5`,
    );

    if (trips.length === 0) {
      console.error('✗ Keine importierten Fahrten. Zuerst einen Fahrplan importieren.');
      process.exitCode = 1;
      return;
    }
    console.log(`Grundlage: ${trips.length} importierte Fahrten.`);

    const tripPayload = trips.map((row, index) => ({
      tripId: row.trip_id,
      serviceDate: row.service_date,
      stopId: row.stop_id,
      delaySeconds: 60 * (index + 2),
    }));

    const tripBytes = buildTripUpdateFeed(tripPayload);
    const alertBytes = buildAlertFeed(trips[0]!.route_id, trips[0]!.stop_id);

    // --- Lokaler Feed-Server (steht für opentransportdata.swiss) -----------
    const server = createServer((request, response) => {
      // Der Produktivpfad sendet einen Authorization-Header; ohne ihn wird
      // hier abgelehnt, damit die Authentifizierung wirklich geprüft ist.
      if (!request.headers.authorization) {
        response.writeHead(401).end('kein Authorization-Header');
        return;
      }
      const body = request.url?.includes('alerts') ? alertBytes : tripBytes;
      response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end(Buffer.from(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // --- 1. TripUpdates: laden, dekodieren, schreiben --------------------
      const tripFeed = await fetchFeedMessage({ url: `${base}/trips`, apiKey: 'testschluessel' });
      const tripResult = await syncTripUpdates(db, tripFeed);
      console.log(
        `✓ TripUpdates: ${tripResult.tripUpdates} Fahrten, ` +
          `${tripResult.stopTimeUpdates} Halte, ${tripResult.cancelled} Ausfälle`,
      );
      await recordFeedHealth(db, 'gtfs_rt_trip_updates', { ok: true, metrics: { tripUpdates: tripResult.tripUpdates } });

      // --- 2. Kommt die Verspätung in der Abfahrtstafel an? ---------------
      const check = await db.queryOne<{ delay_seconds: number | null }>(
        `SELECT delay_seconds FROM transit.realtime_trip_updates
         WHERE trip_id = $1 AND start_date = $2::date`,
        [tripPayload[0]!.tripId, tripPayload[0]!.serviceDate],
      );
      if (check?.delay_seconds !== tripPayload[0]!.delaySeconds) {
        throw new Error(
          `Verspätung nicht übernommen: erwartet ${tripPayload[0]!.delaySeconds}, ` +
            `gefunden ${check?.delay_seconds ?? 'nichts'}`,
        );
      }
      console.log(`✓ Verspätung in der Datenbank: ${check.delay_seconds} s`);

      // --- 3. Service Alerts ----------------------------------------------
      const alertFeed = await fetchFeedMessage({ url: `${base}/alerts`, apiKey: 'testschluessel' });
      const alertResult = await syncServiceAlerts(db, alertFeed);
      console.log(`✓ Service Alerts: ${alertResult.alerts} Meldungen, ${alertResult.entities} Bezüge`);
      await recordFeedHealth(db, 'service_alerts', { ok: true, metrics: { alerts: alertResult.alerts } });

      const alert = await db.queryOne<{ header: Record<string, string>; severity: string }>(
        `SELECT header, severity FROM transit.service_alerts WHERE alert_id = 'alert-verify-1'`,
      );
      if (!alert) throw new Error('Service Alert wurde nicht gespeichert');
      console.log(`✓ Alert gespeichert: „${alert.header.de}" (${alert.severity})`);

      // --- 4. Authentifizierung wirklich nötig? ---------------------------
      let rejected = false;
      try {
        await fetchFeedMessage({ url: `${base}/trips`, apiKey: undefined });
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('Feed wurde ohne Zugangsdaten geladen');
      console.log('✓ Ohne Zugangsdaten wird nicht geladen');

      console.log('');
      console.log('✓ Die Realtime-Kette funktioniert: HTTP → Protobuf → Datenbank.');
      console.log('  Was damit NICHT belegt ist: die Erreichbarkeit von');
      console.log('  opentransportdata.swiss. Dafür: pnpm gtfs:verify-production');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

void main();
