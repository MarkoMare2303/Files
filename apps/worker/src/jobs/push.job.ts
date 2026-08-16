import type { WorkerEnv } from '@swissov/config';
import type { Database } from '@swissov/database';
import webpush, { WebPushError } from 'web-push';
import type { Logger } from '../logger.js';

/**
 * Push-Versand über Web Push (RFC 8030 / VAPID) — §24.
 *
 * Ersetzt den früheren Expo-Push-Versand: das Produkt läuft als PWA im
 * Browser, und dort gibt es kein Expo.
 *
 * Der Worker arbeitet eine Outbox-Tabelle ab. Der Vorteil gegenüber direktem
 * Versand aus der API: keine verlorenen Nachrichten bei Ausfällen, keine
 * Verzögerung der Anfrage, und ein zentraler Ort für die Spam-Vermeidung.
 *
 * Wichtige Unterschiede zu Expo, die die Fehlerbehandlung bestimmen:
 *   • Es gibt keine Ticket-Antwort. Jede Zustellung ist eine eigene
 *     HTTP-Anfrage an den Push-Dienst des Browsers (FCM, Mozilla, Apple).
 *   • 404/410 bedeuten endgültig: das Abo existiert nicht mehr. Es wird
 *     gelöscht, nicht nur deaktiviert — eine tote Zeile hilft niemandem.
 *   • 413 bedeutet: Nutzlast zu gross (Grenze ~4 KB nach Verschlüsselung).
 *     Das ist ein Programmierfehler, kein Netzwerkproblem, und wird als
 *     solcher protokolliert.
 *   • 429 und 5xx sind vorübergehend → erneut versuchen mit Backoff.
 *
 * Der private VAPID-Schlüssel wird ausschliesslich hier verwendet und
 * erreicht weder Browser noch Datenbank noch Logs.
 */
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;

/** Zustellversuche nach dieser Zeit aufgeben — eine alte Meldung ist wertlos. */
const TTL_SECONDS = 900;

interface QueueRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
}

/** Ergebnis eines einzelnen Zustellversuchs. */
type Outcome =
  | { kind: 'SENT' }
  | { kind: 'GONE'; reason: string }
  | { kind: 'RETRY'; reason: string }
  | { kind: 'PERMANENT'; reason: string };

/** Ordnet einen Fehler des Push-Dienstes einer Behandlung zu. */
export function classifyPushError(error: unknown): Outcome {
  if (error instanceof WebPushError) {
    const status = error.statusCode;
    // Abo existiert nicht mehr (abgemeldet, Browser deinstalliert, abgelaufen).
    if (status === 404 || status === 410) return { kind: 'GONE', reason: `HTTP ${status}` };
    // Nutzlast zu gross — erneutes Senden würde exakt gleich scheitern.
    if (status === 413) return { kind: 'PERMANENT', reason: 'Nutzlast zu gross (HTTP 413)' };
    // Ungültige VAPID-Signatur oder falscher Empfänger: Konfigurationsfehler.
    if (status === 401 || status === 403) {
      return { kind: 'PERMANENT', reason: `VAPID abgelehnt (HTTP ${status})` };
    }
    if (status === 429 || status >= 500) return { kind: 'RETRY', reason: `HTTP ${status}` };
    return { kind: 'PERMANENT', reason: `HTTP ${status}` };
  }

  // Netzwerkabbruch, DNS, Timeout → später erneut.
  return { kind: 'RETRY', reason: error instanceof Error ? error.message : String(error) };
}

export function createPushJob(db: Database, env: WorkerEnv, logger: Logger): () => Promise<void> {
  let warnedMissingKeys = false;

  const configured = Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY);
  if (configured) {
    webpush.setVapidDetails(
      // Push-Dienste verlangen einen erreichbaren Kontakt für Rückfragen.
      env.WEB_PUSH_SUBJECT ?? 'mailto:push@swissovlive.ch',
      env.WEB_PUSH_VAPID_PUBLIC_KEY as string,
      env.WEB_PUSH_VAPID_PRIVATE_KEY as string,
    );
  }

  return async () => {
    if (!env.PUSH_ENABLED) return;

    if (!configured) {
      if (!warnedMissingKeys) {
        warnedMissingKeys = true;
        logger.warn(
          'WEB_PUSH_VAPID_PUBLIC_KEY/PRIVATE_KEY nicht gesetzt — Push-Versand ist deaktiviert. ' +
            'Schlüsselpaar erzeugen mit: pnpm --filter @swissov/worker run push:keys',
        );
      }
      return;
    }

    const { rows } = await db.query<QueueRow>(
      `SELECT id, user_id, title, body, data, attempts
       FROM public.notification_queue
       WHERE status = 'PENDING' AND scheduled_at <= now() AND attempts < $1
       ORDER BY scheduled_at
       LIMIT $2`,
      [MAX_ATTEMPTS, BATCH_SIZE],
    );
    if (rows.length === 0) return;

    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const { rows: subscriptionRows } = await db.query<SubscriptionRow>(
      `SELECT id, user_id, endpoint, p256dh, auth_secret
       FROM public.push_subscriptions
       WHERE enabled AND endpoint IS NOT NULL AND user_id = ANY ($1::uuid[])`,
      [`{${userIds.join(',')}}`],
    );

    const byUser = new Map<string, SubscriptionRow[]>();
    for (const row of subscriptionRows) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row);
      byUser.set(row.user_id, list);
    }

    let sent = 0;
    let removed = 0;

    for (const item of rows) {
      const subscriptions = byUser.get(item.user_id) ?? [];

      if (subscriptions.length === 0) {
        // Ohne Abo gibt es nichts zu senden — sauber als übersprungen markieren.
        await db.query(
          `UPDATE public.notification_queue
           SET status = 'SKIPPED', last_error = 'kein Push-Abo' WHERE id = $1`,
          [item.id],
        );
        continue;
      }

      // Die Nutzlast wird Ende-zu-Ende verschlüsselt; der Push-Dienst sieht
      // sie nicht. Trotzdem stehen dort nur Titel, Text und ein Deep-Link —
      // keine Positionsdaten und keine Klarnamen (§23).
      const payload = JSON.stringify({
        title: item.title,
        body: item.body,
        url: deepLinkFor(item.data),
        tag: typeof item.data.tag === 'string' ? item.data.tag : undefined,
      });

      const outcomes = await Promise.all(
        subscriptions.map(async (subscription): Promise<Outcome> => {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
              },
              payload,
              { TTL: TTL_SECONDS, urgency: 'normal' },
            );
            return { kind: 'SENT' };
          } catch (error) {
            return classifyPushError(error);
          }
        }),
      );

      // Tote Abos entfernen, damit sie nicht bei jedem Durchlauf erneut
      // scheitern.
      for (const [index, outcome] of outcomes.entries()) {
        const subscription = subscriptions[index];
        if (!subscription) continue;

        if (outcome.kind === 'GONE') {
          await db.query('DELETE FROM public.push_subscriptions WHERE id = $1', [subscription.id]);
          byUser.set(
            subscription.user_id,
            (byUser.get(subscription.user_id) ?? []).filter((row) => row.id !== subscription.id),
          );
          removed += 1;
          continue;
        }

        if (outcome.kind === 'SENT') {
          await db.query(
            `UPDATE public.push_subscriptions
             SET failure_count = 0, last_error = NULL, last_success_at = now() WHERE id = $1`,
            [subscription.id],
          );
          continue;
        }

        // Dauerhaft fehlerhafte Abos nach mehreren Versuchen stilllegen.
        await db.query(
          `UPDATE public.push_subscriptions
           SET failure_count = failure_count + 1,
               last_error = $2,
               enabled = CASE WHEN failure_count + 1 >= $3 THEN false ELSE enabled END
           WHERE id = $1`,
          [subscription.id, outcome.reason.slice(0, 500), MAX_ATTEMPTS],
        );
      }

      const anySent = outcomes.some((outcome) => outcome.kind === 'SENT');
      const anyRetry = outcomes.some((outcome) => outcome.kind === 'RETRY');

      if (anySent) {
        sent += 1;
        await db.query(
          `UPDATE public.notification_queue SET status = 'SENT', sent_at = now() WHERE id = $1`,
          [item.id],
        );
        continue;
      }

      if (anyRetry) {
        // Backoff über `scheduled_at`: der nächste Versuch wartet, statt den
        // Push-Dienst im Sekundentakt erneut zu treffen.
        const backoffSeconds = Math.min(300, 15 * 2 ** item.attempts);
        await db.query(
          `UPDATE public.notification_queue
           SET attempts = attempts + 1,
               last_error = $2,
               scheduled_at = now() + make_interval(secs => $4::double precision),
               status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END
           WHERE id = $1`,
          [
            item.id,
            firstReason(outcomes).slice(0, 500),
            MAX_ATTEMPTS,
            backoffSeconds,
          ],
        );
        continue;
      }

      // Alle Abos endgültig fehlgeschlagen oder entfernt.
      await db.query(
        `UPDATE public.notification_queue
         SET attempts = attempts + 1, last_error = $2, status = 'FAILED' WHERE id = $1`,
        [item.id, firstReason(outcomes).slice(0, 500)],
      );
    }

    if (sent > 0 || removed > 0) {
      logger.info('Push-Benachrichtigungen verarbeitet', {
        queued: rows.length,
        sent,
        removedSubscriptions: removed,
      });
    }
  };
}

function firstReason(outcomes: Outcome[]): string {
  const failure = outcomes.find((outcome) => outcome.kind !== 'SENT');
  return failure && 'reason' in failure ? failure.reason : 'unbekannt';
}

/**
 * Baut den Deep-Link der Benachrichtigung.
 *
 * Die Pfade entsprechen exakt den Routen der PWA. Ein Link, der ins Leere
 * führt, ist schlimmer als gar keiner — deshalb im Zweifel die Karte.
 */
export function deepLinkFor(data: Record<string, unknown>): string {
  const reportId = typeof data.reportId === 'string' ? data.reportId : null;
  if (reportId) return `/reports/${encodeURIComponent(reportId)}`;

  const tripId = typeof data.tripId === 'string' ? data.tripId : null;
  if (tripId) {
    const serviceDate = typeof data.serviceDate === 'string' ? data.serviceDate : null;
    const query = serviceDate ? `?serviceDate=${encodeURIComponent(serviceDate)}` : '';
    return `/trip/${encodeURIComponent(tripId)}${query}`;
  }

  const stopId = typeof data.stopId === 'string' ? data.stopId : null;
  if (stopId) return `/stop/${encodeURIComponent(stopId)}`;

  return '/map';
}
