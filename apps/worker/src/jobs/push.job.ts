import type { WorkerEnv } from '@swissov/config';
import type { Database } from '@swissov/database';
import type { Logger } from '../logger.js';

/**
 * Push-Versand über den Expo-Push-Service (§24).
 *
 * Der Worker arbeitet eine Outbox-Tabelle ab. Der Vorteil gegenüber direktem
 * Versand aus der API: keine verlorenen Nachrichten bei Ausfällen, keine
 * Verzögerung der Anfrage, und ein zentraler Ort für die Spam-Vermeidung.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 90; // Expo erlaubt bis zu 100 Nachrichten pro Anfrage.
const MAX_ATTEMPTS = 3;

interface QueueRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export function createPushJob(db: Database, env: WorkerEnv, logger: Logger): () => Promise<void> {
  let warned = false;

  return async () => {
    if (!env.PUSH_ENABLED) return;

    const { rows } = await db.query<QueueRow>(
      `SELECT id, user_id, title, body, data, attempts
       FROM public.notification_queue
       WHERE status = 'PENDING' AND scheduled_at <= now() AND attempts < $1
       ORDER BY scheduled_at
       LIMIT $2`,
      [MAX_ATTEMPTS, BATCH_SIZE],
    );
    if (rows.length === 0) return;

    // Empfänger-Tokens auflösen. Ein Nutzer kann mehrere Geräte haben.
    const { rows: tokenRows } = await db.query<{ user_id: string; expo_push_token: string }>(
      `SELECT user_id, expo_push_token FROM public.push_subscriptions
       WHERE enabled AND user_id = ANY ($1::uuid[])`,
      [`{${[...new Set(rows.map((r) => r.user_id))].join(',')}}`],
    );

    const tokensByUser = new Map<string, string[]>();
    for (const row of tokenRows) {
      const list = tokensByUser.get(row.user_id) ?? [];
      list.push(row.expo_push_token);
      tokensByUser.set(row.user_id, list);
    }

    const messages: Array<{ queueId: string; token: string; payload: Record<string, unknown> }> = [];
    for (const row of rows) {
      const tokens = tokensByUser.get(row.user_id) ?? [];
      if (tokens.length === 0) {
        // Ohne Gerät gibt es nichts zu senden — sauber als übersprungen markieren.
        await db.query(
          `UPDATE public.notification_queue SET status = 'SKIPPED', last_error = 'kein Push-Token' WHERE id = $1`,
          [row.id],
        );
        continue;
      }
      for (const token of tokens) {
        messages.push({
          queueId: row.id,
          token,
          payload: {
            to: token,
            title: row.title,
            body: row.body,
            data: row.data,
            sound: 'default',
            channelId: 'reports',
            priority: 'default',
            // Zustellung nur, solange die Meldung relevant ist.
            ttl: 900,
          },
        });
      }
    }

    if (messages.length === 0) return;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
    else if (!warned) {
      warned = true;
      logger.warn(
        'EXPO_ACCESS_TOKEN nicht gesetzt — Push funktioniert, unterliegt aber strengeren ' +
          'Rate Limits von Expo.',
      );
    }

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages.map((m) => m.payload)),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        throw new Error(`Expo-Push antwortete mit HTTP ${response.status}`);
      }

      const result = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = result.data ?? [];

      for (const [index, message] of messages.entries()) {
        const ticket = tickets[index];
        if (!ticket || ticket.status === 'ok') {
          await db.query(
            `UPDATE public.notification_queue SET status = 'SENT', sent_at = now() WHERE id = $1`,
            [message.queueId],
          );
          continue;
        }

        const errorCode = ticket.details?.error ?? ticket.message ?? 'unbekannt';
        await db.query(
          `UPDATE public.notification_queue
           SET attempts = attempts + 1,
               last_error = $2,
               status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END
           WHERE id = $1`,
          [message.queueId, errorCode, MAX_ATTEMPTS],
        );

        // Abgemeldete Geräte dauerhaft deaktivieren, statt es ewig zu versuchen.
        if (errorCode === 'DeviceNotRegistered') {
          await db.query(
            `UPDATE public.push_subscriptions
             SET enabled = false, last_error = $2 WHERE expo_push_token = $1`,
            [message.token, errorCode],
          );
        }
      }

      const sent = tickets.filter((t) => t.status === 'ok').length;
      logger.info('Push-Benachrichtigungen versendet', { sent, total: messages.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Push-Versand fehlgeschlagen', { error: message });
      await db.query(
        `UPDATE public.notification_queue
         SET attempts = attempts + 1,
             last_error = $2,
             status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END
         WHERE id = ANY ($1::uuid[])`,
        [`{${[...new Set(messages.map((m) => m.queueId))].join(',')}}`, message.slice(0, 500), MAX_ATTEMPTS],
      );
    }
  };
}
