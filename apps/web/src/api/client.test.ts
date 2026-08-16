import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, isDefinitelyOffline, setInstallId, setTokenProvider } from './client';

/**
 * Tests des API-Clients (§39/§44).
 *
 * Schwerpunkt sind die Fälle, die im Zug wirklich auftreten: Funkloch,
 * abgelaufenes Token, Serverfehler mit übersetzter Meldung.
 */
function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  const body = response.jsonBody === undefined ? '' : JSON.stringify(response.jsonBody);
  const fake = {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    text: async () => body,
  } as Response;
  return vi.fn().mockResolvedValue(fake);
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

afterEach(() => {
  setOnline(true);
  setTokenProvider(() => null);
});

describe('isDefinitelyOffline', () => {
  it('meldet offline nur bei ausdrücklichem navigator.onLine === false', () => {
    setOnline(false);
    expect(isDefinitelyOffline()).toBe(true);
    setOnline(true);
    expect(isDefinitelyOffline()).toBe(false);
  });
});

describe('apiRequest', () => {
  it('liefert die geparste Antwort', async () => {
    vi.stubGlobal('fetch', mockFetch({ jsonBody: { hello: 'welt' } }));
    await expect(apiRequest<{ hello: string }>('/v1/test')).resolves.toEqual({ hello: 'welt' });
  });

  it('gibt bei 204 undefined zurück, statt JSON zu parsen', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 204 }));
    await expect(apiRequest('/v1/test', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('sendet Token und Installations-ID als Kopfzeilen', async () => {
    const fetchMock = mockFetch({ jsonBody: {} });
    vi.stubGlobal('fetch', fetchMock);
    setTokenProvider(() => 'test-token');
    setInstallId('11111111-2222-4333-8444-555555555555');

    await apiRequest('/v1/test');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-token');
    expect(headers['x-install-id']).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('cacht Antworten nicht — sie sind nutzerbezogen', async () => {
    const fetchMock = mockFetch({ jsonBody: {} });
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/v1/me');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
  });

  it('übernimmt die übersetzte Fehlermeldung des Servers', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ok: false,
        status: 429,
        jsonBody: {
          error: {
            code: 'RATE_LIMITED',
            userMessage: { de: 'Zu viele Meldungen.', fr: 'Trop de signalements.' },
          },
        },
      }),
    );

    await expect(apiRequest('/v1/reports', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      userMessage: 'Zu viele Meldungen.',
    });
  });

  it('erkennt fehlende Verbindung, bevor überhaupt gesendet wird', async () => {
    setOnline(false);
    const fetchMock = mockFetch({ jsonBody: {} });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/v1/test')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wandelt Netzwerkfehler in einen Offline-Fehler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await apiRequest('/v1/test').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isOffline).toBe(true);
  });

  it('markiert 401 als nicht authentifiziert', () => {
    const error = new ApiError('UNAUTHENTICATED', 401, 'Bitte anmelden.');
    expect(error.isUnauthenticated).toBe(true);
    expect(error.isOffline).toBe(false);
  });

  it('hängt Query-Parameter an und lässt undefined weg', async () => {
    const fetchMock = mockFetch({ jsonBody: {} });
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/v1/stops/nearby', { query: { lat: 47.3779, lon: 8.5403, radius: undefined } });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('lat=47.3779');
    expect(url).toContain('lon=8.5403');
    expect(url).not.toContain('radius');
  });
});
