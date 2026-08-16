/**
 * HTTP-Client für externe ÖV-Schnittstellen.
 *
 * Deckt die in §6 geforderten Punkte ab: Timeouts, Redirects, Retry mit
 * exponentiellem Backoff, Beachtung von Rate-Limit-Headern und `Retry-After`.
 */

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Timeout einer einzelnen Anfrage in Millisekunden. */
  timeoutMs?: number;
  /** Anzahl zusätzlicher Versuche nach dem ersten Fehlschlag. */
  retries?: number;
  /** Basiswartezeit für den Backoff. */
  retryBaseDelayMs?: number;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodySnippet: string,
  ) {
    super(`HTTP ${status} für ${url}`);
    this.name = 'HttpError';
  }

  /** 5xx und 429 lohnen einen weiteren Versuch, 4xx sonst nicht. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 408;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
/** Obergrenze, damit ein Poller nicht minutenlang blockiert. */
const MAX_BACKOFF_MS = 30_000;

export function backoffDelayMs(attempt: number, baseDelayMs = DEFAULT_BASE_DELAY_MS): number {
  const exponential = Math.min(MAX_BACKOFF_MS, baseDelayMs * 2 ** attempt);
  // Jitter verhindert, dass mehrere Instanzen synchron erneut anfragen.
  const jitter = Math.random() * exponential * 0.25;
  return Math.round(exponential + jitter);
}

/** Wertet `Retry-After` aus (Sekunden oder HTTP-Datum). */
export function parseRetryAfter(header: string | null, now: Date = new Date()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now.getTime());
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function httpRequest(url: string, options: HttpRequestOptions = {}): Promise<Response> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const init: NonNullable<Parameters<typeof fetch>[1]> = {
        method: options.method ?? 'GET',
        headers: options.headers,
        // `follow` ist der fetch-Standard; explizit, weil die Permalinks von
        // opentransportdata.swiss per 302 auf den eigentlichen Download zeigen.
        redirect: 'follow',
        signal: controller.signal,
      };
      if (options.body !== undefined) {
        (init as { body?: unknown }).body = options.body;
      }
      const response = await fetch(url, init);

      if (response.ok) return response;

      const snippet = await response
        .clone()
        .text()
        .then((text) => text.slice(0, 500))
        .catch(() => '');
      const error = new HttpError(response.status, url, snippet);
      if (!error.retryable || attempt === retries) throw error;

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      await sleep(retryAfter ?? backoffDelayMs(attempt, options.retryBaseDelayMs));
      lastError = error;
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      if (attempt === retries) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      lastError = error;
      await sleep(backoffDelayMs(attempt, options.retryBaseDelayMs));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Anfrage an ${url} fehlgeschlagen`);
}
