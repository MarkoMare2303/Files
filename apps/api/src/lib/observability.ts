/**
 * Observability (§43).
 *
 * Bewusst als Adapter formuliert: ohne konfiguriertes Backend wird nichts
 * übertragen, aber die Aufrufstellen bleiben identisch. Das verhindert, dass
 * später überall im Code Instrumentierung nachgerüstet werden muss.
 */

export interface ErrorContext {
  requestId?: string;
  route?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface ErrorTracker {
  captureException(error: unknown, context?: ErrorContext): void;
  captureMessage(message: string, context?: ErrorContext): void;
}

/**
 * Standardadapter: schreibt strukturiert auf stderr. Sensible Felder werden
 * vor der Ausgabe entfernt (§23 „sensible Logs redigieren").
 */
export class ConsoleErrorTracker implements ErrorTracker {
  captureException(error: unknown, context?: ErrorContext): void {
    const payload = {
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...redact(context ?? {}),
    };
    console.error(JSON.stringify(payload));
  }

  captureMessage(message: string, context?: ErrorContext): void {
    console.error(JSON.stringify({ level: 'warn', message, ...redact(context ?? {}) }));
  }
}

/** Aktiv, wenn kein Backend konfiguriert ist. */
export const noopErrorTracker: ErrorTracker = {
  captureException: () => undefined,
  captureMessage: () => undefined,
};

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'apikey',
  'api_key',
  'secret',
  'jwt',
  'cookie',
  'set-cookie',
  'lat',
  'lon',
  'latitude',
  'longitude',
  'email',
]);

/** Entfernt Geheimnisse und exakte Koordinaten aus Logkontexten. */
export function redact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = '[redacted]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      output[key] = redact(value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output;
}

/** Einfache Zähler-/Histogramm-Metriken für /metrics und das Admin-Dashboard. */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, number[]>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(name: string, valueMs: number): void {
    const bucket = this.durations.get(name) ?? [];
    bucket.push(valueMs);
    // Nur die jüngsten Messwerte behalten — der Prozess soll nicht wachsen.
    if (bucket.length > 1000) bucket.shift();
    this.durations.set(name, bucket);
  }

  snapshot(): Record<string, unknown> {
    const percentiles: Record<string, unknown> = {};
    for (const [name, values] of this.durations) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      percentiles[name] = {
        count: sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted[sorted.length - 1],
      };
    }
    return { counters: Object.fromEntries(this.counters), durations: percentiles };
  }
}

export const metrics = new Metrics();

export function createErrorTracker(sentryDsn: string | undefined): ErrorTracker {
  // Sentry wird bewusst nicht als Abhängigkeit eingebunden; sobald ein DSN
  // gesetzt ist, ersetzt der Betreiber diesen Adapter durch die eigene
  // Integration (siehe docs/deployment.md).
  return sentryDsn ? new ConsoleErrorTracker() : noopErrorTracker;
}
