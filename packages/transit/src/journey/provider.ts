import type { Journey } from '@swissov/types';

/**
 * Abstraktion für die Verbindungssuche (§8).
 *
 * Dahinter stehen zwei Implementierungen:
 *   • `OjpJourneyPlannerProvider`  — Open Journey Planner (vollwertig, mit Umstiegen)
 *   • `GtfsDirectJourneyProvider`  — Direktverbindungen aus den eigenen GTFS-Daten
 *
 * Die API wählt automatisch den besten verfügbaren Provider. Dadurch bleibt
 * die Verbindungssuche auch ohne OJP-Zugang nutzbar, statt einen toten Button
 * zu zeigen (§55).
 */
export interface JourneySearchRequest {
  originStopId: string;
  destinationStopId: string;
  /** Abfahrts- oder Ankunftszeitpunkt. */
  at: Date;
  /** `DEPARTURE`: „ab", `ARRIVAL`: „an". */
  timeMode: 'DEPARTURE' | 'ARRIVAL';
  results?: number;
  locale?: string;
  /** Erlaubte Fahrzeugtypen (GTFS route_type); `undefined` = alle. */
  routeTypes?: number[];
}

export interface JourneySearchResult {
  journeys: Journey[];
  /** Kennzeichnet die Datenquelle — die App weist darauf hin. */
  provider: string;
  /** Einschränkungen dieses Providers, z. B. „nur Direktverbindungen". */
  limitations: string[];
}

export interface JourneyPlannerProvider {
  readonly name: string;
  /** Ob der Provider einsatzbereit ist (z. B. Credentials vorhanden). */
  isAvailable(): boolean;
  search(request: JourneySearchRequest): Promise<JourneySearchResult>;
  /** Kurzer Verfügbarkeitstest für /health. */
  healthcheck(): Promise<{ ok: boolean; message?: string }>;
}

export class JourneyPlannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JourneyPlannerUnavailableError';
  }
}
