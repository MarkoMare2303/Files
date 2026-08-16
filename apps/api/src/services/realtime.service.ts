import type { Report } from '@swissov/types';

/**
 * Echtzeitverteilung neuer Meldungen (§40).
 *
 * Primärkanal ist Supabase Realtime: Die Mobile-App abonniert `public.reports`
 * gefiltert nach Trip, Linie oder Station — nie den gesamten Datenstrom der
 * Schweiz. Änderungen an der Tabelle werden dadurch automatisch verteilt, ohne
 * dass die API etwas senden müsste.
 *
 * Zusätzlich wird ein Broadcast auf einem topic-spezifischen Kanal gesendet.
 * Das erreicht auch Clients, die (etwa im Gastmodus) keine Postgres-Changes
 * abonnieren dürfen, und erlaubt eine kompaktere Nutzlast.
 */
export interface RealtimeOptions {
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
}

export interface BroadcastResult {
  delivered: boolean;
  reason?: string;
}

export class RealtimeBroadcaster {
  constructor(private readonly options: RealtimeOptions) {}

  get isConfigured(): boolean {
    return Boolean(this.options.supabaseUrl && this.options.serviceRoleKey);
  }

  /** Kanalnamen — die App abonniert exakt diese Topics. */
  static topicForTrip(tripId: string, serviceDate: string): string {
    return `trip:${tripId}:${serviceDate}`;
  }

  static topicForRoute(routeId: string): string {
    return `route:${routeId}`;
  }

  static topicForStop(stopId: string): string {
    return `stop:${stopId}`;
  }

  /** Ermittelt alle Topics, auf die eine Meldung verteilt werden soll. */
  static topicsForReport(report: Report): string[] {
    const topics: string[] = [];
    if (report.tripId && report.serviceDate) {
      topics.push(RealtimeBroadcaster.topicForTrip(report.tripId, report.serviceDate));
    }
    if (report.routeId) topics.push(RealtimeBroadcaster.topicForRoute(report.routeId));
    if (report.stopId) topics.push(RealtimeBroadcaster.topicForStop(report.stopId));
    if (report.nextStopId) topics.push(RealtimeBroadcaster.topicForStop(report.nextStopId));
    return [...new Set(topics)];
  }

  async broadcastReport(report: Report, event: 'created' | 'updated' | 'expired'): Promise<BroadcastResult> {
    if (!this.isConfigured) {
      // Ohne Supabase-Zugang verteilt allein Postgres-Changes; die App fällt
      // zusätzlich auf Polling zurück. Kein Fehler, nur eingeschränkt.
      return { delivered: false, reason: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nicht gesetzt' };
    }

    const topics = RealtimeBroadcaster.topicsForReport(report);
    if (topics.length === 0) return { delivered: false, reason: 'kein Topic ableitbar' };

    const messages = topics.map((topic) => ({
      topic,
      event: `report.${event}`,
      payload: {
        id: report.id,
        categoryKey: report.categoryKey,
        tripId: report.tripId,
        serviceDate: report.serviceDate,
        routeId: report.routeId,
        stopId: report.stopId,
        confidence: report.confidence,
        createdAt: report.createdAt,
        expiresAt: report.expiresAt,
      },
      private: false,
    }));

    try {
      const response = await fetch(`${this.options.supabaseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: this.options.serviceRoleKey!,
          authorization: `Bearer ${this.options.serviceRoleKey}`,
        },
        body: JSON.stringify({ messages }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { delivered: false, reason: `Realtime-API antwortete mit ${response.status}` };
      }
      return { delivered: true };
    } catch (error) {
      // Ein fehlgeschlagener Broadcast darf das Erstellen einer Meldung nicht
      // scheitern lassen — die Meldung ist bereits persistiert.
      return {
        delivered: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async healthcheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.isConfigured) {
      return { ok: false, message: 'nicht konfiguriert (SUPABASE_URL/SERVICE_ROLE_KEY fehlen)' };
    }
    try {
      const response = await fetch(`${this.options.supabaseUrl}/rest/v1/`, {
        headers: { apikey: this.options.serviceRoleKey! },
        signal: AbortSignal.timeout(4000),
      });
      return response.ok || response.status === 404
        ? { ok: true }
        : { ok: false, message: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
