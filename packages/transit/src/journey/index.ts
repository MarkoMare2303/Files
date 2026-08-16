import type { Database } from '@swissov/database';
import { GtfsDirectJourneyProvider } from './gtfs-direct.js';
import { OjpJourneyPlannerProvider } from './ojp.js';
import type {
  JourneyPlannerProvider,
  JourneySearchRequest,
  JourneySearchResult,
} from './provider.js';

export * from './provider.js';
export { OjpJourneyPlannerProvider, buildTripRequestXml, parseTripResponse, parseIso8601Duration } from './ojp.js';
export { GtfsDirectJourneyProvider } from './gtfs-direct.js';

export interface JourneyPlannerOptions {
  db: Database;
  ojpEndpointUrl: string;
  ojpApiKey: string | undefined;
  ojpRequestorRef: string;
  /** Feature-Flag `ojp_routing`; deaktiviert OJP auch bei vorhandenem Key. */
  ojpEnabled?: boolean;
}

/**
 * Wählt den besten verfügbaren Provider.
 *
 * Bevorzugt wird OJP (vollwertige Verbindungssuche mit Umstiegen). Fehlt der
 * Zugang oder fällt der Dienst aus, wird auf Direktverbindungen aus den
 * eigenen GTFS-Daten zurückgefallen — die Funktion bleibt damit nutzbar,
 * und die Einschränkung wird ausgewiesen (§8/§44/§55).
 */
export class JourneyPlanner implements JourneyPlannerProvider {
  readonly name = 'auto';
  private readonly ojp: OjpJourneyPlannerProvider;
  private readonly direct: GtfsDirectJourneyProvider;
  private readonly ojpEnabled: boolean;

  constructor(options: JourneyPlannerOptions) {
    this.ojp = new OjpJourneyPlannerProvider({
      endpointUrl: options.ojpEndpointUrl,
      apiKey: options.ojpApiKey,
      requestorRef: options.ojpRequestorRef,
    });
    this.direct = new GtfsDirectJourneyProvider(options.db);
    this.ojpEnabled = options.ojpEnabled ?? true;
  }

  isAvailable(): boolean {
    return true;
  }

  get usesOjp(): boolean {
    return this.ojpEnabled && this.ojp.isAvailable();
  }

  async search(request: JourneySearchRequest): Promise<JourneySearchResult> {
    if (this.usesOjp) {
      try {
        const result = await this.ojp.search(request);
        if (result.journeys.length > 0) return result;
      } catch (error) {
        // Ausfall des externen Planers darf die Funktion nicht komplett
        // unbrauchbar machen — es wird auf eigene Daten zurückgefallen.
        const message = error instanceof Error ? error.message : String(error);
        const fallback = await this.direct.search(request);
        return {
          ...fallback,
          limitations: [
            `Der Routenplaner ist momentan nicht erreichbar (${message}). Angezeigt werden Direktverbindungen aus den Fahrplandaten.`,
            ...fallback.limitations,
          ],
        };
      }
    }
    return this.direct.search(request);
  }

  async healthcheck(): Promise<{ ok: boolean; message?: string }> {
    if (this.usesOjp) return this.ojp.healthcheck();
    const direct = await this.direct.healthcheck();
    return {
      ok: direct.ok,
      message: direct.message ?? 'OJP nicht konfiguriert — nur Direktverbindungen verfügbar',
    };
  }
}
