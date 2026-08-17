import { HttpError, httpRequest, type HttpRequestOptions } from './http.js';

/**
 * Authentifizierung gegenüber opentransportdata.swiss.
 *
 * Die Plattform hat ihr Authentifizierungsverfahren im Laufe der Zeit
 * geändert, und die verschiedenen Dienste (GTFS-Static-Permalink, GTFS-RT 2.0,
 * OJP 2.0) verhalten sich nicht identisch. In der Praxis kommen drei Formen
 * vor:
 *
 *   bearer   Authorization: Bearer <key>     — heutiger Standard
 *   raw      Authorization: <key>            — ältere GTFS-RT-Endpunkte
 *   header   Authorization + apikey: <key>   — von manchen Gateways verlangt
 *
 * Statt eine davon zu raten und den Nutzer mit einem HTTP 401 alleinzulassen,
 * probiert `authorizedRequest()` sie der Reihe nach durch und meldet, welche
 * funktioniert hat. Das kostet im Normalfall nichts: das erste Verfahren ist
 * der Standard und trifft fast immer zu. Nur wenn es scheitert, entstehen
 * zusätzliche Anfragen — und genau dort ist der Nutzen.
 *
 * Wer das Verfahren kennt, setzt `OPENTRANSPORTDATA_AUTH_SCHEME` und spart
 * sich die Fallbacks.
 */
export type AuthScheme = 'bearer' | 'raw' | 'header';

export const AUTH_SCHEMES: readonly AuthScheme[] = ['bearer', 'raw', 'header'];

/** Baut die Kopfzeilen für ein Verfahren. */
export function authHeaders(scheme: AuthScheme, apiKey: string): Record<string, string> {
  switch (scheme) {
    case 'bearer':
      return { authorization: `Bearer ${apiKey}` };
    case 'raw':
      return { authorization: apiKey };
    case 'header':
      return { authorization: `Bearer ${apiKey}`, apikey: apiKey };
  }
}

/** Welche Verfahren in welcher Reihenfolge versucht werden. */
export function schemeOrder(preferred?: string | undefined): AuthScheme[] {
  const first = AUTH_SCHEMES.find((scheme) => scheme === preferred);
  if (!first) return [...AUTH_SCHEMES];
  return [first, ...AUTH_SCHEMES.filter((scheme) => scheme !== first)];
}

/** Nur bei diesen Statuscodes lohnt ein anderes Verfahren. */
function isAuthFailure(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 403);
}

export interface AuthorizedResult {
  response: Response;
  /** Das Verfahren, mit dem die Anfrage durchging. */
  scheme: AuthScheme;
}

/**
 * Führt eine authentifizierte Anfrage aus und wechselt bei 401/403 das
 * Verfahren.
 *
 * Wichtig: Ein 403 kann auch von einem Firmen-Proxy stammen, nicht vom
 * Zielsystem. Deshalb wird der Fehler des ERSTEN Versuchs geworfen, wenn alle
 * Verfahren scheitern — er beschreibt die eigentliche Ursache am besten.
 */
export async function authorizedRequest(
  url: string,
  apiKey: string,
  options: HttpRequestOptions = {},
  preferredScheme?: string | undefined,
): Promise<AuthorizedResult> {
  const schemes = schemeOrder(preferredScheme);
  let firstError: unknown;

  for (const scheme of schemes) {
    try {
      const response = await httpRequest(url, {
        ...options,
        headers: { ...options.headers, ...authHeaders(scheme, apiKey) },
      });
      return { response, scheme };
    } catch (error) {
      firstError ??= error;
      // Alles ausser einer Zurückweisung der Zugangsdaten wird sofort
      // weitergereicht — ein Timeout wird durch ein anderes Verfahren nicht
      // besser.
      if (!isAuthFailure(error)) throw error;
    }
  }

  throw firstError instanceof Error ? firstError : new Error(`Anfrage an ${url} fehlgeschlagen`);
}
