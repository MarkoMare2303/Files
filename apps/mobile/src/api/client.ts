import type { LocalizedText } from '@swissov/types';
import { config } from '../config.js';
import { getLocale, t } from '../i18n/index.js';

/**
 * API-Client.
 *
 * Zentralisiert Authentifizierung, Timeouts, Fehlerübersetzung und die
 * Unterscheidung „offline" vs. „Serverfehler". Screens sprechen nie direkt
 * mit `fetch`.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    /** Bereits übersetzter, anzeigbarer Text (§44). */
    readonly userMessage: string,
    readonly details?: unknown,
  ) {
    super(`${code}: ${userMessage}`);
    this.name = 'ApiError';
  }

  /** Netzwerkfehler — die App kann auf zwischengespeicherte Daten ausweichen. */
  get isOffline(): boolean {
    return this.code === 'NETWORK';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

type TokenProvider = () => string | null;

let tokenProvider: TokenProvider = () => null;
let installId: string | null = null;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

export function setInstallId(value: string): void {
  installId = value;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
  /** Auch ohne Token senden (Gastmodus). */
  allowAnonymous?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${config.apiUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function localized(text: LocalizedText | undefined, fallback: string): string {
  if (!text) return fallback;
  const locale = getLocale();
  return text[locale] ?? text.de ?? fallback;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-language': getLocale(),
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (installId) headers['x-install-id'] = installId;

  const token = tokenProvider();
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const error = (payload as { error?: { code?: string; userMessage?: LocalizedText; details?: unknown } })
        ?.error;
      throw new ApiError(
        error?.code ?? 'UNKNOWN',
        response.status,
        localized(error?.userMessage, t('error.generic')),
        error?.details,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // AbortError und Netzwerkfehler landen hier — beides bedeutet für den
    // Nutzer dasselbe: gerade keine Verbindung (§39/§44).
    throw new ApiError('NETWORK', 0, t('error.offline'));
  } finally {
    clearTimeout(timeout);
  }
}
