import type { Database } from '@swissov/database';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { authorizedRequest } from '../auth.js';

/**
 * GTFS-Realtime-Integration (§6).
 *
 * Verwendet Protocol Buffers — nicht die JSON-Testschnittstellen einzelner
 * Anbieter. Die Credentials liegen ausschliesslich serverseitig; die Mobile-App
 * spricht diesen Endpunkt nie direkt an.
 */

const { transit_realtime: rt } = GtfsRealtimeBindings;

export class MissingCredentialsError extends Error {
  constructor(readonly variable: string) {
    super(
      `${variable} ist nicht gesetzt. Ohne diesen Wert liefert opentransportdata.swiss keine ` +
        'Echtzeitdaten. Ein kostenloses Konto und ein API-Token sind unter ' +
        'https://opentransportdata.swiss/de/register/ erhältlich (siehe .env.example).',
    );
    this.name = 'MissingCredentialsError';
  }
}

export interface FetchFeedOptions {
  url: string;
  apiKey: string | undefined;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Erzwingt ein Authentifizierungsverfahren; sonst wird durchprobiert. */
  authScheme?: string | undefined;
}

/** Lädt und dekodiert eine GTFS-RT-FeedMessage. */
export async function fetchFeedMessage(
  options: FetchFeedOptions,
): Promise<GtfsRealtimeBindings.transit_realtime.FeedMessage> {
  if (!options.apiKey) throw new MissingCredentialsError('OPENTRANSPORTDATA_API_KEY');

  const { response } = await authorizedRequest(
    options.url,
    options.apiKey,
    {
      headers: {
        accept: 'application/octet-stream, application/x-protobuf',
        'user-agent': 'swissov-live/0.1',
      },
      timeoutMs: options.timeoutMs ?? 45_000,
      retries: 2,
      ...(options.signal ? { signal: options.signal } : {}),
    },
    options.authScheme,
  );

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error('Leere GTFS-RT-Antwort');

  try {
    return rt.FeedMessage.decode(buffer);
  } catch (error) {
    // Häufigste Ursache: der Endpunkt hat eine HTML-Fehlerseite geliefert.
    const preview = Buffer.from(buffer.slice(0, 80)).toString('utf8').replace(/\s+/g, ' ');
    throw new Error(
      `GTFS-RT-Antwort ist kein gültiges Protocol-Buffer-Dokument (${
        error instanceof Error ? error.message : String(error)
      }). Beginn der Antwort: "${preview}"`,
    );
  }
}

export interface TripUpdateSyncResult {
  tripUpdates: number;
  stopTimeUpdates: number;
  cancelled: number;
  feedTimestamp: Date | null;
}

const SCHEDULE_RELATIONSHIP: Record<number, string> = {
  0: 'SCHEDULED',
  1: 'ADDED',
  2: 'UNSCHEDULED',
  3: 'CANCELED',
  4: 'DUPLICATED',
  5: 'DELETED',
  6: 'REPLACEMENT',
};

const STOP_TIME_RELATIONSHIP: Record<number, string> = {
  0: 'SCHEDULED',
  1: 'DELETED',
  2: 'SCHEDULED',
  3: 'UNSCHEDULED',
};

function toDate(value: number | Long | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const seconds = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

interface Long {
  toString(): string;
}

/** Normalisiert `YYYYMMDD` aus dem TripDescriptor. */
function toServiceDate(value: string | null | undefined, fallback: Date): string {
  if (value && /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  // Ohne start_date gilt der laufende Betriebstag in Schweizer Ortszeit.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fallback);
}

/**
 * Schreibt Trip Updates in die Datenbank.
 *
 * Der Feed ist ein Vollabzug: Fahrten, die nicht mehr enthalten sind, werden
 * nach einer Karenzzeit entfernt, damit keine veralteten Verspätungen
 * angezeigt werden.
 */
export async function syncTripUpdates(
  db: Database,
  feed: GtfsRealtimeBindings.transit_realtime.FeedMessage,
): Promise<TripUpdateSyncResult> {
  const feedTimestamp = toDate(feed.header?.timestamp as number | undefined);
  const now = new Date();
  let tripUpdates = 0;
  let stopTimeUpdates = 0;
  let cancelled = 0;

  const seenKeys: Array<{ tripId: string; serviceDate: string }> = [];

  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate;
    if (!update?.trip?.tripId) continue;

    const tripId = update.trip.tripId;
    const serviceDate = toServiceDate(update.trip.startDate, feedTimestamp ?? now);
    const relationship =
      SCHEDULE_RELATIONSHIP[update.trip.scheduleRelationship ?? 0] ?? 'SCHEDULED';
    if (relationship === 'CANCELED') cancelled += 1;

    // Gesamtverspätung: bevorzugt das explizite `delay`-Feld, sonst der erste
    // Stop-Time-Update-Eintrag mit Verspätungsangabe.
    let delaySeconds: number | null =
      typeof update.delay === 'number' ? update.delay : null;
    if (delaySeconds === null) {
      for (const stu of update.stopTimeUpdate ?? []) {
        const candidate = stu.departure?.delay ?? stu.arrival?.delay;
        if (typeof candidate === 'number') {
          delaySeconds = candidate;
          break;
        }
      }
    }

    const inserted = await db.queryOne<{ id: string }>(
      `INSERT INTO transit.realtime_trip_updates (
         trip_id, start_date, route_id, direction_id, schedule_relationship,
         vehicle_id, vehicle_label, delay_seconds, feed_timestamp, received_at
       )
       VALUES ($1, $2, $3, $4, $5::transit.schedule_relationship, $6, $7, $8, $9, now())
       ON CONFLICT (trip_id, start_date) DO UPDATE SET
         route_id = EXCLUDED.route_id,
         direction_id = EXCLUDED.direction_id,
         schedule_relationship = EXCLUDED.schedule_relationship,
         vehicle_id = EXCLUDED.vehicle_id,
         vehicle_label = EXCLUDED.vehicle_label,
         delay_seconds = EXCLUDED.delay_seconds,
         feed_timestamp = EXCLUDED.feed_timestamp,
         received_at = now()
       RETURNING id`,
      [
        tripId,
        serviceDate,
        update.trip.routeId ?? null,
        update.trip.directionId ?? null,
        relationship,
        update.vehicle?.id ?? null,
        update.vehicle?.label ?? null,
        delaySeconds,
        feedTimestamp,
      ],
    );
    if (!inserted) continue;
    tripUpdates += 1;
    seenKeys.push({ tripId, serviceDate });

    const stus = update.stopTimeUpdate ?? [];
    if (stus.length > 0) {
      // Vollabzug je Fahrt: alte Halteprognosen ersetzen.
      await db.query('DELETE FROM transit.realtime_stop_time_updates WHERE trip_update_id = $1', [
        inserted.id,
      ]);
      for (const stu of stus) {
        if (stu.stopSequence === null || stu.stopSequence === undefined) continue;
        await db.query(
          `INSERT INTO transit.realtime_stop_time_updates (
             trip_update_id, stop_sequence, stop_id,
             arrival_time, arrival_delay, departure_time, departure_delay, schedule_relationship
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::transit.schedule_relationship)
           ON CONFLICT (trip_update_id, stop_sequence) DO NOTHING`,
          [
            inserted.id,
            stu.stopSequence,
            stu.stopId ?? null,
            toDate(stu.arrival?.time as number | undefined),
            stu.arrival?.delay ?? null,
            toDate(stu.departure?.time as number | undefined),
            stu.departure?.delay ?? null,
            STOP_TIME_RELATIONSHIP[stu.scheduleRelationship ?? 0] ?? 'SCHEDULED',
          ],
        );
        stopTimeUpdates += 1;
      }
    }
  }

  // Veraltete Einträge entfernen: alles, was seit 20 Minuten nicht mehr im
  // Feed enthalten war, ist keine belastbare Prognose mehr.
  await db.query(
    `DELETE FROM transit.realtime_trip_updates WHERE received_at < now() - interval '20 minutes'`,
  );

  return { tripUpdates, stopTimeUpdates, cancelled, feedTimestamp };
}

export interface ServiceAlertSyncResult {
  alerts: number;
  entities: number;
  removed: number;
}

const SEVERITY: Record<number, string> = {
  1: 'UNKNOWN',
  2: 'INFO',
  3: 'WARNING',
  4: 'SEVERE',
};

interface TranslatedString {
  translation?: Array<{ text?: string | null; language?: string | null } | null> | null;
}

/** GTFS-RT TranslatedString → `{ de: "...", fr: "..." }`. */
export function translationsToJson(value: TranslatedString | null | undefined): Record<string, string> | null {
  if (!value?.translation || value.translation.length === 0) return null;
  const result: Record<string, string> = {};
  for (const translation of value.translation) {
    if (!translation?.text) continue;
    const language = (translation.language ?? 'de').toLowerCase().split('-')[0] ?? 'de';
    if (['de', 'fr', 'it', 'en'].includes(language)) {
      result[language] = translation.text;
    } else if (!result.de) {
      result.de = translation.text;
    }
  }
  if (Object.keys(result).length === 0) return null;
  // Deutsch ist der Fallback der App; notfalls die erste vorhandene Sprache.
  if (!result.de) {
    const first = Object.values(result)[0];
    if (first) result.de = first;
  }
  return result;
}

/**
 * Leerstring → null.
 *
 * Notwendig für alles, was aus Protocol Buffers kommt: dort ist der
 * Standardwert einer nicht gesetzten Zeichenkette `''` und nicht `undefined`.
 */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function syncServiceAlerts(
  db: Database,
  feed: GtfsRealtimeBindings.transit_realtime.FeedMessage,
): Promise<ServiceAlertSyncResult> {
  const seenAlertIds: string[] = [];
  let alerts = 0;
  let entities = 0;

  for (const entity of feed.entity ?? []) {
    const alert = entity.alert;
    if (!alert) continue;

    const header = translationsToJson(alert.headerText as TranslatedString);
    if (!header) continue; // Ohne Titel ist eine Meldung nicht darstellbar.

    const description = translationsToJson(alert.descriptionText as TranslatedString);
    const urlTranslations = translationsToJson(alert.url as TranslatedString);
    const period = alert.activePeriod?.[0];

    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO transit.service_alerts (
         alert_id, cause, effect, severity, header, description, url,
         active_from, active_until, updated_at, removed_at
       )
       VALUES ($1, $2, $3, $4::transit.alert_severity, $5::jsonb, $6::jsonb, $7, $8, $9, now(), NULL)
       ON CONFLICT (alert_id) DO UPDATE SET
         cause = EXCLUDED.cause,
         effect = EXCLUDED.effect,
         severity = EXCLUDED.severity,
         header = EXCLUDED.header,
         description = EXCLUDED.description,
         url = EXCLUDED.url,
         active_from = EXCLUDED.active_from,
         active_until = EXCLUDED.active_until,
         removed_at = NULL,
         updated_at = now()
       RETURNING id`,
      [
        entity.id,
        alert.cause ? String(rt.Alert.Cause[alert.cause] ?? alert.cause) : null,
        alert.effect ? String(rt.Alert.Effect[alert.effect] ?? alert.effect) : null,
        SEVERITY[alert.severityLevel ?? 1] ?? 'UNKNOWN',
        JSON.stringify(header),
        description ? JSON.stringify(description) : null,
        urlTranslations?.de ?? null,
        toDate(period?.start as number | undefined),
        toDate(period?.end as number | undefined),
      ],
    );
    if (!row) continue;
    alerts += 1;
    seenAlertIds.push(entity.id);

    await db.query('DELETE FROM transit.service_alert_entities WHERE alert_id = $1', [row.id]);
    for (const informed of alert.informedEntity ?? []) {
      // Protocol Buffers kennen keine „nicht gesetzten" Zeichenketten: nicht
      // belegte Felder kommen als LEERSTRING an, nicht als undefined. Ein
      // `?? null` greift dabei nicht — es würde '' schreiben.
      //
      // Genau das passierte: eine InformedEntity mit nur `routeId` erzeugte
      // Zeilen mit stop_id = '' und agency_id = ''. Die Abfrage der API filtert
      // auf `IS NOT NULL`, liess die Leerstrings also durch, und die
      // Antwortvalidierung (`gtfsIdSchema`, min. 1 Zeichen) schlug fehl —
      // `GET /v1/alerts` antwortete mit 500, für JEDE echte Störungsmeldung.
      const agencyId = blankToNull(informed.agencyId);
      const routeId = blankToNull(informed.routeId);
      const tripId = blankToNull(informed.trip?.tripId);
      const stopId = blankToNull(informed.stopId);
      const routeType =
        informed.routeType === null || informed.routeType === undefined ? null : informed.routeType;

      // Eine InformedEntity ohne jeden Bezug beschreibt nichts.
      if (!agencyId && !routeId && !tripId && !stopId && routeType === null) continue;

      await db.query(
        `INSERT INTO transit.service_alert_entities (alert_id, agency_id, route_id, route_type, trip_id, stop_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, agencyId, routeId, routeType, tripId, stopId],
      );
      entities += 1;
    }
  }

  // Nicht mehr im Feed enthaltene Meldungen als beendet markieren.
  const removed = await db.query(
    `UPDATE transit.service_alerts
     SET removed_at = now()
     WHERE removed_at IS NULL AND NOT (alert_id = ANY ($1::text[]))`,
    [seenAlertIds.length > 0 ? `{${seenAlertIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(',')}}` : '{}'],
  );

  return { alerts, entities, removed: removed.rowCount };
}

/** Zustand einer Datenquelle protokollieren (§43). */
export async function recordFeedHealth(
  db: Database,
  component: string,
  outcome: { ok: boolean; error?: string; metrics?: Record<string, unknown> },
): Promise<void> {
  if (outcome.ok) {
    await db.query(
      `INSERT INTO transit.feed_health (component, last_success_at, last_attempt_at, consecutive_failures, last_error, metrics)
       VALUES ($1, now(), now(), 0, NULL, $2::jsonb)
       ON CONFLICT (component) DO UPDATE SET
         last_success_at = now(), last_attempt_at = now(),
         consecutive_failures = 0, last_error = NULL,
         metrics = EXCLUDED.metrics, updated_at = now()`,
      [component, JSON.stringify(outcome.metrics ?? {})],
    );
    return;
  }
  await db.query(
    `INSERT INTO transit.feed_health (component, last_attempt_at, consecutive_failures, last_error)
     VALUES ($1, now(), 1, $2)
     ON CONFLICT (component) DO UPDATE SET
       last_attempt_at = now(),
       consecutive_failures = transit.feed_health.consecutive_failures + 1,
       last_error = EXCLUDED.last_error,
       updated_at = now()`,
    [component, (outcome.error ?? 'unbekannter Fehler').slice(0, 1000)],
  );
}
