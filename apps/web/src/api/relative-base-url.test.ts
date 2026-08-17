import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `NEXT_PUBLIC_API_URL` als Pfad statt als vollständige URL.
 *
 * Warum das zählt: Next.js setzt `NEXT_PUBLIC_*` zur Bauzeit als Literal ins
 * JavaScript ein. Eine absolute URL ist damit fest eingebacken — ein gebautes
 * Auslieferungsbündel liesse sich nicht ohne Neubau auf eine andere Domain
 * legen. Mit einem relativen Pfad (`/api`, hinter dem der Webserver auf die
 * API weiterleitet) ist dasselbe Bündel auf jeder Domain lauffähig.
 *
 * Vorher warf `new URL('/api/v1/…')` ohne Basis einen `TypeError` — der
 * relative Weg war also nicht bloss unschön, sondern unmöglich.
 */
vi.mock('../config', () => ({
  config: {
    apiUrl: '/api',
    supabaseUrl: '',
    supabaseAnonKey: '',
    mapStyleUrl: '',
    appVersion: 'test',
  },
  isAuthConfigured: false,
  isMapConfigured: false,
  SWITZERLAND_CENTER: { latitude: 46.8182, longitude: 8.2275 },
  SWITZERLAND_DEFAULT_ZOOM: 7.2,
}));

const { apiRequest } = await import('./client');

function mockFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('relative API-Basis', () => {
  it('löst einen Pfad gegen die Herkunft des Dokuments auf', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/v1/stops/8503000/departures');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${window.location.origin}/api/v1/stops/8503000/departures`);
  });

  it('behält Abfrageparameter', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/v1/search', { query: { q: 'Olten', limit: 3 } });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${window.location.origin}/api/v1/search?q=Olten&limit=3`);
  });
});
