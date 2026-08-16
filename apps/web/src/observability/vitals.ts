'use client';

/**
 * Performance-Messung (Web Vitals) und optionale Fehlerübermittlung.
 *
 * Zwei feste Regeln, die alles andere bestimmen:
 *
 *   1. **Nichts wird ohne Einwilligung gesendet.** Die Messung läuft erst,
 *      wenn `analyticsConsent` in den Einstellungen aktiv ist. Ohne
 *      Einwilligung passiert hier gar nichts — kein Beacon, kein Sammeln.
 *   2. **Niemals Standortdaten, niemals Kontodaten.** Übermittelt werden
 *      ausschliesslich vier Zahlen und der Routen-*Muster*name. Aus
 *      `/trip/85:11:1234` wird `/trip/[tripId]` — sonst würde über den Pfad
 *      verraten, mit welchem Zug jemand fährt.
 *
 * Ein Sentry-SDK ist bewusst NICHT eingebunden: es würde standardmässig URLs,
 * Breadcrumbs und Formularinhalte mitschicken. Wer Sentry einsetzen will,
 * findet in `sanitizeEvent()` die Stelle, an der die Bereinigung passieren
 * muss — vor dem Versand, nicht danach.
 */
export interface VitalSample {
  /** LCP, INP, CLS oder TTFB. */
  name: 'LCP' | 'INP' | 'CLS' | 'TTFB';
  value: number;
  /** Routenmuster, nie der konkrete Pfad. */
  route: string;
}

/**
 * Ersetzt identifizierende Pfadsegmente durch ihr Muster.
 *
 * `/trip/85:11:1234?serviceDate=2025-03-11` → `/trip/[tripId]`
 * `/reports/9f8e…`                          → `/reports/[reportId]`
 * `/stop/8503000`                           → `/stop/[stopId]`
 */
export function routePattern(pathname: string): string {
  const clean = pathname.split('?')[0] ?? pathname;
  const segments = clean.split('/').filter(Boolean);
  if (segments.length < 2) return `/${segments.join('/')}`;

  const [head] = segments;
  switch (head) {
    case 'trip':
      return '/trip/[tripId]';
    case 'reports':
      return '/reports/[reportId]';
    case 'stop':
      return '/stop/[stopId]';
    default:
      return `/${segments.join('/')}`;
  }
}

/**
 * Entfernt aus einem Fehlerereignis alles, was eine Person oder eine Fahrt
 * identifizieren könnte. Wird vor jedem Versand angewandt.
 */
export function sanitizeEvent(event: Record<string, unknown>): Record<string, unknown> {
  const forbidden = [
    'lat',
    'lon',
    'latitude',
    'longitude',
    'coords',
    'observations',
    'accessToken',
    'authorization',
    'email',
    'installId',
  ];

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (forbidden.includes(key)) {
          result[key] = '[entfernt]';
          continue;
        }
        result[key] = walk(entry);
      }
      return result;
    }
    if (typeof value === 'string') {
      // URLs im Text ebenfalls auf ihr Muster reduzieren.
      return value.replace(/\/(trip|reports|stop)\/[^\s"'?]+/g, (_match, kind: string) =>
        routePattern(`/${kind}/x`),
      );
    }
    return value;
  };

  return walk(event) as Record<string, unknown>;
}

/** Sammelt die Kernmetriken über die Performance-APIs des Browsers. */
export function startVitals(
  onSample: (sample: VitalSample) => void,
  options: { enabled: boolean },
): () => void {
  if (!options.enabled || typeof PerformanceObserver === 'undefined') return () => undefined;

  const route = routePattern(window.location.pathname);
  const observers: PerformanceObserver[] = [];

  const observe = (type: string, handler: (entries: PerformanceEntryList) => void): void => {
    try {
      const observer = new PerformanceObserver((list) => handler(list.getEntries()));
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      // Nicht jeder Browser kennt jeden Eintragstyp — kein Grund zu scheitern.
    }
  };

  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1];
    if (last) onSample({ name: 'LCP', value: Math.round(last.startTime), route });
  });

  observe('event', (entries) => {
    for (const entry of entries) {
      const duration = (entry as PerformanceEntry & { duration: number }).duration;
      // Nur wahrnehmbare Verzögerungen sind interessant.
      if (duration >= 40) onSample({ name: 'INP', value: Math.round(duration), route });
    }
  });

  observe('layout-shift', (entries) => {
    let total = 0;
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (!shift.hadRecentInput) total += shift.value;
    }
    if (total > 0) onSample({ name: 'CLS', value: Math.round(total * 1000) / 1000, route });
  });

  const navigation = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navigation) {
    onSample({ name: 'TTFB', value: Math.round(navigation.responseStart), route });
  }

  return () => {
    for (const observer of observers) observer.disconnect();
  };
}
