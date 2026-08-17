import type { Page, Route } from '@playwright/test';

/**
 * API-Attrappe für die E2E-Tests.
 *
 * Warum nicht gegen die echte API testen? Weil diese Tests die OBERFLÄCHE
 * prüfen sollen: Navigation, Offline-Verhalten, Installierbarkeit,
 * Quellenkennzeichnung. Die API hat ihre eigenen Integrationstests gegen eine
 * echte PostGIS-Datenbank (`apps/api/src/api.integration.test.ts`).
 *
 * Die Antworten hier entsprechen exakt den Zod-Schemata aus `@swissov/types`,
 * und die Kategorieschlüssel entsprechen den Seeds aus `packages/database`
 * (`ticket_inspection`, nicht `TICKET_INSPECTION`) — eine Attrappe, die
 * anders aussieht als der echte Server, prüft nichts.
 */
const API = 'http://127.0.0.1:3001';

const nowIso = (offsetMinutes = 0): string =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString();

export const APP_CONFIG = {
  categories: [
    {
      key: 'ticket_inspection',
      label: { de: 'Kontrolle', fr: 'Contrôle', it: 'Controllo', en: 'Inspection' },
      group: 'INFO',
      icon: 'shield',
      color: '#1E6BAA',
      defaultScope: 'VEHICLE_TRIP',
      allowedScopes: ['VEHICLE_TRIP', 'STATION'],
      requiresTrip: false,
      ttlSeconds: 1800,
      sortOrder: 1,
      enabled: true,
    },
    {
      key: 'delay_mismatch',
      label: { de: 'Verspätung', fr: 'Retard', it: 'Ritardo', en: 'Delay' },
      group: 'DISRUPTION',
      icon: 'clock',
      color: '#E0A32E',
      defaultScope: 'VEHICLE_TRIP',
      allowedScopes: ['VEHICLE_TRIP'],
      requiresTrip: false,
      ttlSeconds: 3600,
      sortOrder: 2,
      enabled: true,
    },
    {
      key: 'very_high_occupancy',
      label: { de: 'Sehr voll', fr: 'Très plein', it: 'Molto pieno', en: 'Crowded' },
      group: 'CAPACITY',
      icon: 'users',
      color: '#F2701A',
      defaultScope: 'VEHICLE_TRIP',
      allowedScopes: ['VEHICLE_TRIP'],
      requiresTrip: false,
      ttlSeconds: 1800,
      sortOrder: 3,
      enabled: true,
    },
  ],
  features: { journeySearch: true },
  detection: { autoThreshold: 0.9, confirmThreshold: 0.7, defaultRadiusMeters: 1200 },
  limits: { messageMaxLength: 280, reportsPerHour: 20 },
  dataSources: {
    timetable: true,
    realtime: false,
    officialAlerts: true,
    journeyPlanner: 'gtfs-direct',
  },
  webPush: { enabled: false, publicKey: null },
};

export const COMMUNITY_REPORT = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'COMMUNITY',
  categoryKey: 'ticket_inspection',
  categoryLabel: { de: 'Kontrolle', fr: 'Contrôle', it: 'Controllo', en: 'Inspection' },
  categoryIcon: 'shield',
  categoryColor: '#1E6BAA',
  scope: 'VEHICLE_TRIP',
  status: 'ACTIVE',
  agencyId: '11',
  routeId: 'route-ic3',
  routeShortName: 'IC 3',
  tripId: 'trip-ic3-1',
  serviceDate: '2025-03-11',
  vehicleType: 'RAIL',
  directionId: 0,
  stopId: '8500218',
  stopName: 'Olten',
  nextStopId: '8500020',
  nextStopName: 'Liestal',
  lat: 47.378,
  lon: 8.54,
  message: 'Kontrolle im vorderen Wagen.',
  confidence: 82,
  upvotes: 4,
  downvotes: 0,
  myVote: null,
  isMine: false,
  authorAlias: 'Blaues Tram',
  createdAt: nowIso(-6),
  expiresAt: nowIso(24),
};

export const OFFICIAL_ALERT = {
  id: 'alert-1',
  source: 'OFFICIAL',
  severity: 'WARNING',
  cause: 'TECHNICAL_PROBLEM',
  effect: 'SIGNIFICANT_DELAYS',
  header: { de: 'Störung zwischen Olten und Liestal', fr: '', it: '', en: '' },
  description: { de: 'Wegen einer technischen Störung verkehren die Züge verspätet.', fr: '', it: '', en: '' },
  url: null,
  activeFrom: nowIso(-60),
  activeUntil: nowIso(120),
  affectedRouteIds: ['route-ic3'],
  affectedStopIds: ['8500218'],
  affectedTripIds: [],
  affectedAgencyIds: ['11'],
  updatedAt: nowIso(-5),
};

const DEPARTURES = [
  {
    tripId: 'trip-ic3-1',
    serviceDate: '2025-03-11',
    stopId: '8500218',
    stopName: 'Olten',
    platformCode: 'Gleis 7',
    routeId: 'route-ic3',
    routeShortName: 'IC 3',
    routeColor: null,
    vehicleType: 'RAIL',
    agencyName: 'SBB',
    headsign: 'Basel SBB',
    directionId: 0,
    scheduledDeparture: nowIso(6),
    realtimeDeparture: null,
    delaySeconds: null,
    cancelled: false,
  },
  {
    tripId: 'trip-s3-1',
    serviceDate: '2025-03-11',
    stopId: '8500218',
    stopName: 'Olten',
    platformCode: 'Gleis 3',
    routeId: 'route-s3',
    routeShortName: 'S 3',
    routeColor: null,
    vehicleType: 'RAIL',
    agencyName: 'SBB',
    headsign: 'Aarau',
    directionId: 0,
    scheduledDeparture: nowIso(11),
    // Nur eine Verspätung, kein Echtzeit-Zeitpunkt → die angezeigte Zeit ist
    // gerechnet, nicht gemeldet. Muss als GESCHÄTZT gekennzeichnet werden.
    realtimeDeparture: null,
    delaySeconds: 180,
    cancelled: false,
  },
  {
    tripId: 'trip-s9-1',
    serviceDate: '2025-03-11',
    stopId: '8500218',
    stopName: 'Olten',
    platformCode: 'Gleis 5',
    routeId: 'route-s9',
    routeShortName: 'S 9',
    routeColor: null,
    vehicleType: 'RAIL',
    agencyName: 'SBB',
    headsign: 'Sursee',
    directionId: 0,
    scheduledDeparture: nowIso(17),
    // Echtzeit-Zeitpunkt des Betriebs → LIVE.
    realtimeDeparture: nowIso(18),
    delaySeconds: 60,
    cancelled: false,
  },
];

const TRIP = {
  tripId: 'trip-ic3-1',
  serviceDate: '2025-03-11',
  routeId: 'route-ic3',
  routeShortName: 'IC 3',
  routeLongName: 'Zürich HB – Basel SBB',
  routeColor: null,
  agencyId: '11',
  agencyName: 'SBB',
  vehicleType: 'RAIL',
  headsign: 'Basel SBB',
  directionId: 0,
  origin: 'Zürich HB',
  destination: 'Basel SBB',
  delaySeconds: 120,
  cancelled: false,
  stops: [
    {
      stopId: '8500218',
      stopName: 'Olten',
      stopSequence: 5,
      lat: 47.3519,
      lon: 7.9077,
      platformCode: 'Gleis 7',
      scheduledArrival: nowIso(-4),
      scheduledDeparture: nowIso(-3),
      realtimeArrival: nowIso(-2),
      realtimeDeparture: nowIso(-1),
      delaySeconds: 120,
      skipped: false,
    },
    {
      stopId: '8500020',
      stopName: 'Liestal',
      stopSequence: 6,
      lat: 47.4842,
      lon: 7.7315,
      platformCode: null,
      scheduledArrival: nowIso(10),
      scheduledDeparture: nowIso(11),
      realtimeArrival: null,
      realtimeDeparture: null,
      delaySeconds: null,
      skipped: false,
    },
  ],
};

const STOPS = [
  {
    stopId: '8500218',
    name: 'Olten',
    code: null,
    lat: 47.3519,
    lon: 7.9077,
    locationType: 1,
    parentStation: null,
    platformCode: null,
    wheelchairBoarding: 1,
    distanceMeters: 120,
  },
  {
    stopId: '8500020',
    name: 'Liestal',
    code: null,
    lat: 47.4842,
    lon: 7.7315,
    locationType: 1,
    parentStation: null,
    platformCode: null,
    wheelchairBoarding: 1,
    distanceMeters: 830,
  },
];

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

export interface MockOptions {
  /** Gibt die API auf jede Anfrage einen Netzwerkfehler zurück? */
  offline?: boolean;
  /** Sind Meldungen vorhanden? */
  reports?: boolean;
  /** Web Push serverseitig eingerichtet? */
  webPush?: { enabled: boolean; publicKey: string | null };
}

/** Fängt alle API-Aufrufe ab und beantwortet sie deterministisch. */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<void> {
  const items = options.reports === false ? [] : [OFFICIAL_ALERT, COMMUNITY_REPORT];

  await page.route(`${API}/**`, async (route) => {
    if (options.offline) {
      await route.abort('internetdisconnected');
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname;

    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
      return;
    }

    if (path === '/v1/app-config') {
      await json(route, { ...APP_CONFIG, webPush: options.webPush ?? APP_CONFIG.webPush });
      return;
    }
    if (path === '/v1/reports/categories') {
      await json(route, { categories: APP_CONFIG.categories });
      return;
    }
    if (path === '/v1/reports' && route.request().method() === 'GET') {
      await json(route, { items });
      return;
    }
    if (path === '/v1/reports' && route.request().method() === 'POST') {
      await json(route, { report: COMMUNITY_REPORT, warnings: [] });
      return;
    }
    if (path.startsWith('/v1/reports/')) {
      await json(route, { report: COMMUNITY_REPORT });
      return;
    }
    if (path === '/v1/stops/nearby') {
      await json(route, { stops: STOPS });
      return;
    }
    if (path.endsWith('/departures')) {
      await json(route, { departures: DEPARTURES, realtimeAvailable: false });
      return;
    }
    if (path.startsWith('/v1/trips/') && path.endsWith('/reports')) {
      await json(route, { items });
      return;
    }
    if (path.startsWith('/v1/trips/')) {
      await json(route, { trip: TRIP });
      return;
    }
    if (path === '/v1/search') {
      const q = url.searchParams.get('q') ?? '';
      await json(route, {
        results: q.length >= 2
          ? [
              {
                kind: 'STOP',
                id: '8500218',
                name: 'Olten',
                subtitle: 'Bahnhof',
                lat: 47.3519,
                lon: 7.9077,
                vehicleType: 'RAIL',
                score: 0.9,
              },
            ]
          : [],
      });
      return;
    }
    if (path === '/v1/trip-detection') {
      await json(route, { decision: 'NONE', candidates: [], evaluatedAt: nowIso() });
      return;
    }
    if (path === '/v1/trip-sessions/current') {
      await json(route, { session: null });
      return;
    }
    if (path === '/v1/me' || path.startsWith('/v1/me/')) {
      // Gastmodus: die App darf hier keine Daten erwarten.
      await json(route, { error: { code: 'UNAUTHENTICATED', userMessage: { de: 'Bitte anmelden.' } } }, 401);
      return;
    }

    await json(route, { error: { code: 'NOT_FOUND', userMessage: { de: 'Nicht gefunden.' } } }, 404);
  });
}

/** Simuliert einen kompletten Netzausfall — auch für die eigene Domain. */
export async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true);
}

export async function goOnline(page: Page): Promise<void> {
  await page.context().setOffline(false);
}
