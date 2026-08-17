import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TEST_STOPS, secondsSinceMidnight } from './test/fixtures.js';
import { createHarness, type TestHarness, type TestUser } from './test/harness.js';

/**
 * Integrationstests gegen eine echte PostgreSQL/PostGIS-Datenbank (§48).
 *
 * Abgedeckte Abläufe: Fahrplanabfragen, Fahrtenerkennung, Meldung erstellen,
 * sehen, bestätigen, melden, Ablauf, Moderation und Kontolöschung.
 */
describe('API-Integration', () => {
  let harness: TestHarness;
  let user: TestUser;
  let otherUser: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser();
    otherUser = await harness.createUser();
    admin = await harness.createUser({ role: 'ADMIN' });
  });

  afterAll(async () => {
    await harness?.close();
  });

  // --- Betrieb ---------------------------------------------------------------

  describe('Betriebsendpunkte', () => {
    it('/health antwortet ohne Abhängigkeiten', async () => {
      const response = await harness.server.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('ok');
    });

    it('/ready prüft Datenbank und Fahrplandaten', async () => {
      const response = await harness.server.inject({ method: 'GET', url: '/ready' });
      expect([200, 503]).toContain(response.statusCode);
      const body = response.json();
      const database = body.components.find((c: { component: string }) => c.component === 'database');
      const gtfs = body.components.find((c: { component: string }) => c.component === 'gtfs_static');
      expect(database.status).toBe('OK');
      expect(gtfs.status).toBe('OK');
    });

    it('/metrics ist ohne Adminrolle gesperrt', async () => {
      const anonymous = await harness.server.inject({ method: 'GET', url: '/metrics' });
      expect(anonymous.statusCode).toBe(401);

      const asUser = await harness.server.inject({
        method: 'GET',
        url: '/metrics',
        headers: user.authHeader,
      });
      expect(asUser.statusCode).toBe(403);

      const asAdmin = await harness.server.inject({
        method: 'GET',
        url: '/metrics',
        headers: admin.authHeader,
      });
      expect(asAdmin.statusCode).toBe(200);
    });

    it('liefert eine gültige OpenAPI-Spezifikation', async () => {
      const response = await harness.server.inject({ method: 'GET', url: '/openapi.json' });
      expect(response.statusCode).toBe(200);
      const spec = response.json();
      expect(spec.openapi).toMatch(/^3\./);
      expect(Object.keys(spec.paths)).toContain('/v1/reports');
      expect(Object.keys(spec.paths)).toContain('/v1/trip-detection');
    });
  });

  // --- Fahrplan --------------------------------------------------------------

  describe('Fahrplandaten', () => {
    it('findet Haltestellen in der Nähe von Zürich HB', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: `/v1/stops/nearby?lat=${TEST_STOPS.zurichHb.lat}&lon=${TEST_STOPS.zurichHb.lon}&radius=1000`,
      });
      expect(response.statusCode).toBe(200);
      const { stops } = response.json();
      expect(stops.length).toBeGreaterThan(0);
      expect(stops[0].stopId).toBe(TEST_STOPS.zurichHb.id);
      expect(stops[0].distanceMeters).toBeLessThan(50);
      // Zürich Altstetten liegt ~4 km entfernt und darf nicht enthalten sein.
      expect(stops.map((s: { stopId: string }) => s.stopId)).not.toContain(
        TEST_STOPS.zurichAltstetten.id,
      );
    });

    it('sortiert nach Distanz und respektiert den Radius', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: `/v1/stops/nearby?lat=${TEST_STOPS.zurichHb.lat}&lon=${TEST_STOPS.zurichHb.lon}&radius=6000`,
      });
      const { stops } = response.json();
      const distances = stops.map((s: { distanceMeters: number }) => s.distanceMeters);
      expect([...distances].sort((a, b) => a - b)).toEqual(distances);
      expect(stops.map((s: { stopId: string }) => s.stopId)).toContain(
        TEST_STOPS.zurichAltstetten.id,
      );
    });

    it('liefert Abfahrten mit aufgelösten Zeiten', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: `/v1/stops/${TEST_STOPS.zurichAltstetten.id}/departures`,
      });
      expect(response.statusCode).toBe(200);
      const { departures } = response.json();
      expect(departures.length).toBeGreaterThan(0);
      expect(departures[0].routeShortName).toBe('IC 3');
      expect(departures[0].vehicleType).toBe('RAIL');
      expect(new Date(departures[0].scheduledDeparture).getTime()).toBeGreaterThan(0);
    });

    it('liefert eine Fahrt mit allen Halten', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: `/v1/trips/t-ic3-1?serviceDate=${harness.feed.serviceDate}`,
      });
      expect(response.statusCode).toBe(200);
      const { trip } = response.json();
      expect(trip.routeShortName).toBe('IC 3');
      expect(trip.origin).toBe('Zürich HB');
      expect(trip.destination).toBe('Basel SBB');
      expect(trip.stops).toHaveLength(6);
      expect(trip.stops[0].stopName).toBe('Zürich HB');
      expect(trip.cancelled).toBe(false);
    });

    it('meldet unbekannte Fahrten verständlich', async () => {
      const response = await harness.server.inject({ method: 'GET', url: '/v1/trips/gibt-es-nicht' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
      expect(response.json().error.userMessage.de).toBeTruthy();
    });

    it('findet Haltestellen unscharf und ohne Diakritika', async () => {
      const response = await harness.server.inject({ method: 'GET', url: '/v1/search?q=Zurich' });
      expect(response.statusCode).toBe(200);
      const names = response.json().results.map((r: { name: string }) => r.name);
      expect(names.some((n: string) => n.includes('Zürich'))).toBe(true);
    });

    it('findet Linien über die Kurzbezeichnung', async () => {
      const response = await harness.server.inject({ method: 'GET', url: '/v1/search?q=IC 3' });
      const routes = response
        .json()
        .results.filter((r: { kind: string }) => r.kind === 'ROUTE');
      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0].id).toBe('r-ic3');
    });
  });

  // --- Fahrtenerkennung ------------------------------------------------------

  describe('Fahrtenerkennung', () => {
    /** Position zwischen Zürich HB und Altstetten, in Fahrtrichtung Westen. */
    function icObservations(now = new Date()) {
      const between = (fraction: number) => ({
        lat:
          TEST_STOPS.zurichHb.lat +
          (TEST_STOPS.zurichAltstetten.lat - TEST_STOPS.zurichHb.lat) * fraction,
        lon:
          TEST_STOPS.zurichHb.lon +
          (TEST_STOPS.zurichAltstetten.lon - TEST_STOPS.zurichHb.lon) * fraction,
      });
      return [
        {
          ...between(0.3),
          accuracy: 12,
          speed: 22,
          heading: 290,
          timestamp: new Date(now.getTime() - 60_000).toISOString(),
        },
        {
          ...between(0.6),
          accuracy: 12,
          speed: 24,
          heading: 290,
          timestamp: now.toISOString(),
        },
      ];
    }

    it('erkennt den IC 3 aus GPS-Beobachtungen', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/trip-detection',
        payload: { observations: icObservations(), limit: 5 },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.candidates.length).toBeGreaterThan(0);
      expect(body.candidates[0].tripId).toBe('t-ic3-1');
      expect(body.candidates[0].destination).toBe('Basel SBB');
      expect(body.candidates[0].confidence).toBeGreaterThan(0.7);
      expect(['AUTO_SELECT', 'CONFIRM']).toContain(body.decision);
    });

    it('liefert eine nachvollziehbare Score-Aufschlüsselung', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/trip-detection',
        payload: { observations: icObservations() },
      });
      const { breakdown } = response.json().candidates[0];
      expect(Object.keys(breakdown).sort()).toEqual([
        'directionCompatibility',
        'realtimeCompatibility',
        'shapeDistance',
        'speedCompatibility',
        'stopSequence',
        'timeCompatibility',
      ]);
      expect(breakdown.shapeDistance.raw).toBeGreaterThan(0.8);
    });

    it('liefert für eine Position ohne ÖV-Nähe keine Kandidaten', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/trip-detection',
        payload: {
          observations: [
            { lat: 46.5, lon: 7.0, accuracy: 10, speed: 0, timestamp: new Date().toISOString() },
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().candidates).toHaveLength(0);
      expect(response.json().decision).toBe('NONE');
    });

    it('lehnt Positionen ausserhalb der Schweiz ab, ohne zu scheitern', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/trip-detection',
        payload: {
          observations: [
            { lat: 52.52, lon: 13.405, accuracy: 10, timestamp: new Date().toISOString() },
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().decision).toBe('NONE');
    });

    it('startet und beendet eine Fahrt-Sitzung', async () => {
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/trip-sessions',
        headers: user.authHeader,
        payload: {
          tripId: 't-ic3-1',
          serviceDate: harness.feed.serviceDate,
          confidence: 0.94,
          detectionMethod: 'AUTO_GPS',
        },
      });
      expect(created.statusCode).toBe(201);
      const { session } = created.json();
      expect(session.tripId).toBe('t-ic3-1');
      expect(session.following).toBe(false);

      const current = await harness.server.inject({
        method: 'GET',
        url: '/v1/trip-sessions/current',
        headers: user.authHeader,
      });
      expect(current.json().session.id).toBe(session.id);

      const followed = await harness.server.inject({
        method: 'POST',
        url: `/v1/trip-sessions/${session.id}/follow`,
        headers: user.authHeader,
        payload: { following: true },
      });
      expect(followed.json().session.following).toBe(true);

      const ended = await harness.server.inject({
        method: 'DELETE',
        url: `/v1/trip-sessions/${session.id}`,
        headers: user.authHeader,
      });
      expect(ended.statusCode).toBe(204);

      const after = await harness.server.inject({
        method: 'GET',
        url: '/v1/trip-sessions/current',
        headers: user.authHeader,
      });
      expect(after.json().session).toBeNull();
    });

    it('verlangt eine Anmeldung für Fahrt-Sitzungen', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/trip-sessions',
        payload: {
          tripId: 't-ic3-1',
          serviceDate: harness.feed.serviceDate,
          confidence: 0.9,
          detectionMethod: 'MANUAL',
        },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // --- Meldungen -------------------------------------------------------------

  describe('Community-Meldungen', () => {
    it('liefert die Kategorien aus der Datenbank', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: '/v1/reports/categories',
      });
      expect(response.statusCode).toBe(200);
      const { categories } = response.json();
      expect(categories.length).toBeGreaterThan(20);
      const keys = categories.map((c: { key: string }) => c.key);
      expect(keys).toContain('ticket_inspection');
      expect(keys).toContain('high_occupancy');
      expect(keys).toContain('aircon_failure');
    });

    it('erstellt eine Meldung mit abgeleitetem Fahrtkontext', async () => {
      const session = await startSession(harness, user);

      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: user.authHeader,
        payload: {
          categoryKey: 'high_occupancy',
          tripSessionId: session.id,
          lat: 47.385,
          lon: 8.512,
          accuracy: 14,
          speed: 22,
        },
      });
      expect(response.statusCode).toBe(201);
      const { report } = response.json();
      expect(report.source).toBe('COMMUNITY');
      expect(report.categoryKey).toBe('high_occupancy');
      expect(report.tripId).toBe('t-ic3-1');
      expect(report.routeId).toBe('r-ic3');
      expect(report.scope).toBe('VEHICLE_TRIP');
      expect(report.isMine).toBe(true);
      // Position wird gerundet gespeichert (§23)
      expect(report.lat).toBe(47.385);
      expect(report.confidence).toBeGreaterThan(0);
      expect(new Date(report.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('zeigt die Meldung anderen Fahrgästen derselben Fahrt', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: `/v1/trips/t-ic3-1/reports?serviceDate=${harness.feed.serviceDate}`,
        headers: otherUser.authHeader,
      });
      expect(response.statusCode).toBe(200);
      const community = response
        .json()
        .items.filter((i: { source: string }) => i.source === 'COMMUNITY');
      expect(community.length).toBeGreaterThan(0);
      expect(community[0].categoryKey).toBe('high_occupancy');
      expect(community[0].isMine).toBe(false);
      // Autor wird pseudonym angezeigt, nie mit E-Mail.
      expect(community[0].authorAlias).toBeTruthy();
      expect(community[0].authorAlias).not.toContain('@');
    });

    it('blockiert eine zweite gleichartige Meldung desselben Nutzers', async () => {
      const session = await startSession(harness, user);
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: user.authHeader,
        payload: { categoryKey: 'high_occupancy', tripSessionId: session.id },
      });
      // Statt eines Fehlers wird auf die bestehende Meldung verwiesen.
      expect(response.statusCode).toBe(201);
      expect(response.json().mergedInto).toBeTruthy();
      expect(response.json().warnings.length).toBeGreaterThan(0);
    });

    it('ist idempotent gegenüber der Offline-Queue', async () => {
      const third = await harness.createUser();
      const session = await startSession(harness, third);
      const clientReportId = '11111111-2222-3333-4444-555555555555';

      const first = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: third.authHeader,
        payload: { categoryKey: 'door_defect', tripSessionId: session.id, clientReportId },
      });
      const second = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: third.authHeader,
        payload: { categoryKey: 'door_defect', tripSessionId: session.id, clientReportId },
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json().report.id).toBe(first.json().report.id);

      const count = await harness.db.queryOne<{ count: number }>(
        'SELECT count(*)::int AS count FROM public.reports WHERE user_id = $1',
        [third.id],
      );
      expect(count?.count).toBe(1);
    });

    it('verlangt eine Anmeldung zum Melden', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        payload: { categoryKey: 'high_occupancy', tripId: 't-ic3-1' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.userMessage.de).toContain('melde dich an');
    });

    it('lehnt Meldungen ohne jeden Bezug ab', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: user.authHeader,
        payload: { categoryKey: 'high_occupancy' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('begrenzt die Länge des Freitexts', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: user.authHeader,
        payload: {
          categoryKey: 'other',
          tripId: 't-ic3-1',
          serviceDate: harness.feed.serviceDate,
          message: 'x'.repeat(500),
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('blockiert physikalisch unmögliche Ortswechsel', async () => {
      const traveller = await harness.createUser();
      const first = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: traveller.authHeader,
        payload: {
          categoryKey: 'ticket_inspection',
          stopId: TEST_STOPS.zurichHb.id,
          lat: TEST_STOPS.zurichHb.lat,
          lon: TEST_STOPS.zurichHb.lon,
        },
      });
      expect(first.statusCode).toBe(201);

      // Sekunden später in Genf — unmöglich.
      const second = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: traveller.authHeader,
        payload: {
          categoryKey: 'ticket_inspection',
          stopId: TEST_STOPS.baselSbb.id,
          lat: 46.2103,
          lon: 6.1424,
        },
      });
      expect(second.statusCode).toBe(422);
      expect(second.json().error.code).toBe('ABUSE_BLOCKED');

      const signals = await harness.db.query(
        `SELECT signal FROM public.abuse_signals WHERE user_id = $1`,
        [traveller.id],
      );
      expect(signals.rows.map((r) => (r as { signal: string }).signal)).toContain(
        'IMPOSSIBLE_TRAVEL',
      );
    });

    it('lehnt Positionen ausserhalb des Bediengebiets ab', async () => {
      const foreigner = await harness.createUser();
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: foreigner.authHeader,
        payload: { categoryKey: 'other', lat: 48.8566, lon: 2.3522 },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.userMessage.de).toContain('Schweiz');
    });
  });

  // --- Bestätigungen ---------------------------------------------------------

  describe('Bestätigungen', () => {
    it('erhöht die Confidence bei Bestätigung', async () => {
      const author = await harness.createUser();
      const session = await startSession(harness, author);
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: author.authHeader,
        payload: { categoryKey: 'technical_disruption', tripSessionId: session.id },
      });
      const reportId = created.json().report.id;
      const before = created.json().report.confidence;

      const voted = await harness.server.inject({
        method: 'POST',
        url: `/v1/reports/${reportId}/vote`,
        headers: otherUser.authHeader,
        payload: { vote: 1 },
      });
      expect(voted.statusCode).toBe(200);
      expect(voted.json().report.upvotes).toBe(1);
      expect(voted.json().report.confidence).toBeGreaterThan(before);
      expect(voted.json().report.myVote).toBe(1);
    });

    it('erlaubt nur eine Stimme pro Nutzer und Meldung', async () => {
      const author = await harness.createUser();
      const voter = await harness.createUser();
      const session = await startSession(harness, author);
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: author.authHeader,
        payload: { categoryKey: 'heating_failure', tripSessionId: session.id },
      });
      const reportId = created.json().report.id;

      await harness.server.inject({
        method: 'POST',
        url: `/v1/reports/${reportId}/vote`,
        headers: voter.authHeader,
        payload: { vote: 1 },
      });
      const second = await harness.server.inject({
        method: 'POST',
        url: `/v1/reports/${reportId}/vote`,
        headers: voter.authHeader,
        payload: { vote: -1 },
      });
      expect(second.statusCode).toBe(200);
      // Die Stimme wird ersetzt, nicht addiert.
      expect(second.json().report.upvotes).toBe(0);
      expect(second.json().report.downvotes).toBe(1);
    });

    it('verhindert das Bewerten eigener Meldungen', async () => {
      const author = await harness.createUser();
      const session = await startSession(harness, author);
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: author.authHeader,
        payload: { categoryKey: 'toilet_defect', tripSessionId: session.id },
      });
      const response = await harness.server.inject({
        method: 'POST',
        url: `/v1/reports/${created.json().report.id}/vote`,
        headers: author.authHeader,
        payload: { vote: 1 },
      });
      expect(response.statusCode).toBe(403);
    });

    it('beendet Meldungen mit klarer Mehrheit an Gegenstimmen', async () => {
      const author = await harness.createUser();
      const session = await startSession(harness, author);
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: author.authHeader,
        payload: { categoryKey: 'limited_space', tripSessionId: session.id },
      });
      const reportId = created.json().report.id;

      for (let i = 0; i < 5; i += 1) {
        const voter = await harness.createUser();
        await harness.server.inject({
          method: 'POST',
          url: `/v1/reports/${reportId}/vote`,
          headers: voter.authHeader,
          payload: { vote: -1 },
        });
      }

      const status = await harness.db.queryOne<{ status: string }>(
        'SELECT status FROM public.reports WHERE id = $1',
        [reportId],
      );
      expect(status?.status).toBe('EXPIRED');
    });
  });

  // --- Missbrauchsmeldungen und Moderation -----------------------------------

  describe('Moderation', () => {
    it('schiebt mehrfach gemeldete Beiträge in die Queue', async () => {
      const author = await harness.createUser();
      const session = await startSession(harness, author);
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: author.authHeader,
        payload: { categoryKey: 'heavy_soiling', tripSessionId: session.id },
      });
      const reportId = created.json().report.id;

      let queued = false;
      for (let i = 0; i < 3; i += 1) {
        const flagger = await harness.createUser();
        const response = await harness.server.inject({
          method: 'POST',
          url: `/v1/reports/${reportId}/flag`,
          headers: flagger.authHeader,
          payload: { reason: 'SPAM' },
        });
        expect(response.statusCode).toBe(200);
        queued = queued || response.json().queuedForModeration;
      }
      expect(queued).toBe(true);

      // Für Aussenstehende nicht mehr sichtbar …
      const asOther = await harness.server.inject({
        method: 'GET',
        url: `/v1/reports/${reportId}`,
        headers: otherUser.authHeader,
      });
      expect(asOther.statusCode).toBe(404);

      // … für den Autor weiterhin.
      const asAuthor = await harness.server.inject({
        method: 'GET',
        url: `/v1/reports/${reportId}`,
        headers: author.authHeader,
      });
      expect(asAuthor.statusCode).toBe(200);
    });

    it('erlaubt Administratoren das Entfernen und Wiederherstellen', async () => {
      const author = await harness.createUser();
      const session = await startSession(harness, author);
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: author.authHeader,
        payload: { categoryKey: 'quiet_coach', tripSessionId: session.id },
      });
      const reportId = created.json().report.id;

      const removed = await harness.server.inject({
        method: 'POST',
        url: `/v1/admin/reports/${reportId}/moderate`,
        headers: admin.authHeader,
        payload: { action: 'REMOVE', reason: 'Verstoss gegen die Regeln' },
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().report.status).toBe('REMOVED');

      // Reputation des Autors sinkt.
      const profile = await harness.db.queryOne<{ reputation_score: number }>(
        'SELECT reputation_score FROM public.profiles WHERE id = $1',
        [author.id],
      );
      expect(profile!.reputation_score).toBeLessThan(0);

      // Audit-Log ist geschrieben.
      const audit = await harness.db.queryOne<{ action: string }>(
        `SELECT action FROM public.admin_audit_logs
         WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [reportId],
      );
      expect(audit?.action).toBe('report.remove');

      const restored = await harness.server.inject({
        method: 'POST',
        url: `/v1/admin/reports/${reportId}/moderate`,
        headers: admin.authHeader,
        payload: { action: 'RESTORE', reason: 'Fehlentscheid korrigiert' },
      });
      expect(restored.json().report.status).toBe('ACTIVE');
    });

    it('verweigert normalen Nutzern den Admin-Bereich', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: '/v1/admin/dashboard',
        headers: user.authHeader,
      });
      expect(response.statusCode).toBe(403);
    });

    it('liefert das Admin-Dashboard mit echten Kennzahlen', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: '/v1/admin/dashboard',
        headers: admin.authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.users.total).toBeGreaterThan(0);
      expect(body.reports.today).toBeGreaterThan(0);
      expect(body.transit.activeImport.feedVersion).toBe('test-fixture');
      expect(Array.isArray(body.reports.byCategory)).toBe(true);
    });

    it('sperrt und entsperrt Nutzer', async () => {
      const target = await harness.createUser();

      const suspended = await harness.server.inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/moderate`,
        headers: admin.authHeader,
        payload: { action: 'SUSPEND', reason: 'Wiederholte Falschmeldungen', durationHours: 24 },
      });
      expect(suspended.statusCode).toBe(200);
      expect(suspended.json().user.status).toBe('SUSPENDED');

      const blocked = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: target.authHeader,
        payload: { categoryKey: 'other', stopId: TEST_STOPS.zurichHb.id },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe('ACCOUNT_SUSPENDED');

      const reinstated = await harness.server.inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/moderate`,
        headers: admin.authHeader,
        payload: { action: 'REINSTATE', reason: 'Einspruch stattgegeben' },
      });
      expect(reinstated.json().user.status).toBe('ACTIVE');
    });

    it('versteckt Beiträge shadow-geflaggter Nutzer vor anderen', async () => {
      const target = await harness.createUser();
      await harness.server.inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/moderate`,
        headers: admin.authHeader,
        payload: { action: 'SHADOW_FLAG', reason: 'Spam-Verdacht' },
      });

      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: target.authHeader,
        payload: { categoryKey: 'other', stopId: TEST_STOPS.olten.id },
      });
      expect(created.statusCode).toBe(201);
      // Der Autor sieht die Meldung wie gewohnt …
      expect(created.json().report.status).toBe('ACTIVE');

      const reportId = created.json().report.id;
      const asOther = await harness.server.inject({
        method: 'GET',
        url: `/v1/reports/${reportId}`,
        headers: otherUser.authHeader,
      });
      // … alle anderen nicht.
      expect(asOther.statusCode).toBe(404);
    });
  });

  // --- Konto -----------------------------------------------------------------

  describe('Konto', () => {
    it('liefert Profil und Einstellungen', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: '/v1/me',
        headers: user.authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.profile.alias).toBeTruthy();
      expect(body.profile).not.toHaveProperty('email');
      expect(body.profile).not.toHaveProperty('reputationScore');
      expect(body.settings.backgroundLocationConsent).toBe(false);
      expect(body.settings.analyticsConsent).toBe(false);
    });

    it('speichert Einstellungsänderungen inklusive Einwilligungen', async () => {
      const response = await harness.server.inject({
        method: 'PATCH',
        url: '/v1/me/settings',
        headers: user.authHeader,
        payload: {
          theme: 'DARK',
          analyticsConsent: true,
          notifications: { highOccupancy: true },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().settings.theme).toBe('DARK');
      expect(response.json().settings.analyticsConsent).toBe(true);
      expect(response.json().settings.notifications.highOccupancy).toBe(true);

      const consent = await harness.db.queryOne<{ analytics_consent_at: Date | null }>(
        'SELECT analytics_consent_at FROM public.user_settings WHERE user_id = $1',
        [user.id],
      );
      expect(consent?.analytics_consent_at).not.toBeNull();
    });

    it('registriert ein Web-Push-Abo und meldet es wieder ab', async () => {
      const installId = '11111111-2222-4333-8444-555555555555';
      const endpoint = 'https://fcm.googleapis.com/fcm/send/test-endpoint-abcdef123456';

      const device = await harness.server.inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: user.authHeader,
        payload: { installId, platform: 'web', appVersion: '0.1.0' },
      });
      expect(device.statusCode).toBe(200);

      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/me/push-subscriptions',
        headers: user.authHeader,
        payload: {
          installId,
          subscription: {
            endpoint,
            keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
            expirationTime: null,
          },
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
        },
      });
      expect(created.statusCode).toBe(200);
      expect(created.json().subscriptionId).toBeTruthy();

      const stored = await harness.db.queryOne<{ endpoint: string; enabled: boolean; device_id: string | null }>(
        'SELECT endpoint, enabled, device_id FROM public.push_subscriptions WHERE user_id = $1',
        [user.id],
      );
      expect(stored?.endpoint).toBe(endpoint);
      expect(stored?.enabled).toBe(true);
      // Das Abo wird dem registrierten Gerät zugeordnet.
      expect(stored?.device_id).not.toBeNull();

      const removed = await harness.server.inject({
        method: 'DELETE',
        url: '/v1/me/push-subscriptions',
        headers: user.authHeader,
        payload: { endpoint },
      });
      expect(removed.statusCode).toBe(204);

      const after = await harness.db.query(
        'SELECT 1 FROM public.push_subscriptions WHERE user_id = $1',
        [user.id],
      );
      expect(after.rows).toHaveLength(0);
    });

    it('aktualisiert ein bestehendes Abo, statt es zu duplizieren', async () => {
      const installId = '22222222-3333-4444-8555-666666666666';
      const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/test-endpoint-xyz';

      const payload = {
        installId,
        subscription: { endpoint, keys: { p256dh: 'C'.repeat(87), auth: 'b'.repeat(22) } },
      };

      await harness.server.inject({
        method: 'POST',
        url: '/v1/me/push-subscriptions',
        headers: user.authHeader,
        payload,
      });
      await harness.server.inject({
        method: 'POST',
        url: '/v1/me/push-subscriptions',
        headers: user.authHeader,
        payload: {
          ...payload,
          subscription: { endpoint, keys: { p256dh: 'D'.repeat(87), auth: 'c'.repeat(22) } },
        },
      });

      const rows = await harness.db.query<{ p256dh: string }>(
        'SELECT p256dh FROM public.push_subscriptions WHERE endpoint = $1',
        [endpoint],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.p256dh).toBe('D'.repeat(87));
    });

    it('verhindert das Abmelden fremder Abos', async () => {
      const endpoint = 'https://fcm.googleapis.com/fcm/send/fremdes-abo-123456';

      await harness.server.inject({
        method: 'POST',
        url: '/v1/me/push-subscriptions',
        headers: user.authHeader,
        payload: {
          installId: '33333333-4444-4555-8666-777777777777',
          subscription: { endpoint, keys: { p256dh: 'E'.repeat(87), auth: 'd'.repeat(22) } },
        },
      });

      // Ein anderer Nutzer kennt den Endpunkt — löschen darf er ihn trotzdem nicht.
      const attempt = await harness.server.inject({
        method: 'DELETE',
        url: '/v1/me/push-subscriptions',
        headers: otherUser.authHeader,
        payload: { endpoint },
      });
      expect(attempt.statusCode).toBe(204);

      const survived = await harness.db.query(
        'SELECT 1 FROM public.push_subscriptions WHERE endpoint = $1',
        [endpoint],
      );
      expect(survived.rows).toHaveLength(1);
    });

    it('lehnt ein Push-Abo ohne Anmeldung ab', async () => {
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/me/push-subscriptions',
        payload: {
          installId: '44444444-5555-4666-8777-888888888888',
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/anonym-123456',
            keys: { p256dh: 'F'.repeat(87), auth: 'e'.repeat(22) },
          },
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('verwaltet Favoriten', async () => {
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/me/favorites',
        headers: user.authHeader,
        payload: { kind: 'STOP', label: 'Zürich HB', stopId: TEST_STOPS.zurichHb.id },
      });
      expect(created.statusCode).toBe(201);

      const duplicate = await harness.server.inject({
        method: 'POST',
        url: '/v1/me/favorites',
        headers: user.authHeader,
        payload: { kind: 'STOP', label: 'Zürich HB', stopId: TEST_STOPS.zurichHb.id },
      });
      expect(duplicate.statusCode).toBe(409);

      const list = await harness.server.inject({
        method: 'GET',
        url: '/v1/me/favorites',
        headers: user.authHeader,
      });
      expect(list.json().favorites).toHaveLength(1);

      const removed = await harness.server.inject({
        method: 'DELETE',
        url: `/v1/me/favorites/${created.json().favorite.id}`,
        headers: user.authHeader,
      });
      expect(removed.statusCode).toBe(204);
    });

    it('exportiert alle eigenen Daten', async () => {
      const response = await harness.server.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: user.authHeader,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.profile.id).toBe(user.id);
      expect(Array.isArray(body.reports)).toBe(true);
      expect(Array.isArray(body.tripSessions)).toBe(true);
      expect(body.generatedAt).toBeTruthy();
    });

    it('löscht das Konto samt aller Daten', async () => {
      const doomed = await harness.createUser();
      const session = await startSession(harness, doomed);
      await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: doomed.authHeader,
        payload: { categoryKey: 'bike_spaces_full', tripSessionId: session.id },
      });

      const response = await harness.server.inject({
        method: 'DELETE',
        url: '/v1/me',
        headers: doomed.authHeader,
        payload: { confirm: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().deleted).toBe(true);

      for (const table of ['reports', 'trip_sessions', 'profiles']) {
        const remaining = await harness.db.queryOne<{ count: number }>(
          table === 'profiles'
            ? 'SELECT count(*)::int AS count FROM public.profiles WHERE id = $1'
            : `SELECT count(*)::int AS count FROM public.${table} WHERE user_id = $1`,
          [doomed.id],
        );
        expect(remaining?.count).toBe(0);
      }
    });
  });

  // --- Verbindungssuche ------------------------------------------------------

  describe('Meldungsbezug ohne aktive Fahrt', () => {
    // Eigene Konten: die Meldungen weiter oben lösen für `user` einen
    // Cooldown aus, und ein Test soll nicht von der Reihenfolge abhängen.
    let stationUser: TestUser;
    let nowhereUser: TestUser;

    beforeAll(async () => {
      stationUser = await harness.createUser();
      nowhereUser = await harness.createUser();
    });

    it('ordnet eine Meldung an der Haltestelle der Station zu', async () => {
      // Meldungen an einem Bahnhof ohne laufende Fahrt sind ein Kernfall
      // („Kontrolle am Perron"). Ohne Auflösung aus der Position gab es dafür
      // keinen Bezug — die Meldung wurde abgelehnt.
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: stationUser.authHeader,
        payload: {
          categoryKey: 'ticket_inspection',
          lat: TEST_STOPS.zurichHb.lat,
          lon: TEST_STOPS.zurichHb.lon,
          accuracy: 15,
          clientReportId: randomUUID(),
          observedAt: new Date().toISOString(),
        },
      });

      expect(response.statusCode).toBe(201);
      const report = response.json().report;
      expect(report.scope).toBe('STATION');
      expect(report.stopName).toBe('Zürich HB');
    });

    it('lehnt eine Meldung ohne jeden Bezug verständlich ab — nicht mit 500', async () => {
      // Ohne Fahrt und ohne Haltestelle in der Nähe lässt sich kein Scope
      // belegen. Früher verletzte die Meldung dabei eine CHECK-Bedingung der
      // Datenbank und der Nutzer sah einen Serverfehler.
      const response = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: nowhereUser.authHeader,
        payload: {
          categoryKey: 'ticket_inspection',
          // Mitten im Wallis, weit weg von jeder Fixture-Haltestelle,
          // aber innerhalb der Schweiz.
          lat: 46.42,
          lon: 7.02,
          accuracy: 15,
          clientReportId: randomUUID(),
          observedAt: new Date().toISOString(),
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('REPORT_CONTEXT_MISSING');
      expect(response.json().error.userMessage.de).toMatch(/Fahrt|Standort/);
    });
  });

  describe('Echte Datenstrukturen des Schweizer Feeds', () => {
    it('zeigt den Stations- statt den Kantennamen', async () => {
      // Im Schweizer Datensatz zeigt `stop_times.stop_id` auf die Kante
      // („Zürich HB, Gleis 31"), nicht auf die Station. Eine Abfahrtstafel,
      // die den Kantennamen ausgibt, wiederholt in jeder Zeile den Bahnhof.
      const quayId = `${TEST_STOPS.zurichHb.id}:0:31`;
      await harness.db.query(
        `INSERT INTO transit.stops
           (feed_id, stop_id, name, geom, geom_lv95, location_type, parent_station, platform_code, wheelchair_boarding)
         VALUES ($1, $2, $3,
                 ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
                 ST_Transform(ST_SetSRID(ST_MakePoint($5, $4), 4326), 2056),
                 0, $6, '31', 1)
         ON CONFLICT DO NOTHING`,
        [
          harness.feed.feedId,
          quayId,
          'Zürich HB, Gleis 31',
          TEST_STOPS.zurichHb.lat,
          TEST_STOPS.zurichHb.lon,
          TEST_STOPS.zurichHb.id,
        ],
      );

      const { rows } = await harness.db.query<{ stop_name: string; platform_code: string | null }>(
        `SELECT stop_name, platform_code FROM transit.departures($1::text[], now(), 720, 5)`,
        [`{${quayId}}`],
      );

      if (rows.length > 0) {
        expect(rows[0]?.stop_name).toBe('Zürich HB');
        expect(rows[0]?.stop_name).not.toContain('Gleis');
        expect(rows[0]?.platform_code).toBe('31');
      }
    });

    it('liefert keine Abfahrt am Endhalt einer Fahrt', async () => {
      // Am letzten Halt steigt niemand mehr ein. Saubere Feeds setzen dafür
      // `pickup_type = 1`, aber darauf ist kein Verlass.
      const { rows } = await harness.db.query<{ trip_id: string; stop_sequence: number }>(
        `SELECT d.trip_id, d.stop_sequence
         FROM transit.departures($1::text[], now(), 1440, 50) d`,
        [`{${TEST_STOPS.baselSbb.id}}`],
      );

      for (const row of rows) {
        const last = await harness.db.queryOne<{ max: number }>(
          `SELECT max(stop_sequence) AS max FROM transit.stop_times
           WHERE feed_id = $1 AND trip_id = $2`,
          [harness.feed.feedId, row.trip_id],
        );
        expect(row.stop_sequence).toBeLessThan(last!.max);
      }
    });

    it('verträgt Leerstrings in Störungsbezügen aus Protocol Buffers', async () => {
      // Protocol Buffers liefern für nicht gesetzte Zeichenketten '' statt
      // NULL. Landeten diese Werte in der Antwort, verletzten sie das Schema
      // und `GET /v1/alerts` antwortete mit 500 — für JEDE echte Meldung.
      await harness.db.query(
        `DELETE FROM transit.service_alerts WHERE alert_id = 'leerstring-test'`,
      );
      const alert = await harness.db.queryOne<{ id: string }>(
        `INSERT INTO transit.service_alerts
           (alert_id, severity, header, description, active_from, active_until)
         VALUES ('leerstring-test', 'WARNING',
                 '{"de":"Testmeldung"}'::jsonb, '{"de":"Beschreibung"}'::jsonb,
                 now() - interval '10 minutes', now() + interval '1 hour')
         RETURNING id`,
      );
      await harness.db.query(
        `INSERT INTO transit.service_alert_entities (alert_id, agency_id, route_id, trip_id, stop_id)
         VALUES ($1, '', $2, '', '')`,
        [alert!.id, 'ic3'],
      );

      const response = await harness.server.inject({ method: 'GET', url: '/v1/alerts' });
      expect(response.statusCode).toBe(200);

      const found = response.json().alerts.find((a: { id: string }) => a.id === 'leerstring-test');
      expect(found).toBeDefined();
      expect(found.affectedRouteIds).toEqual(['ic3']);
      // Die Leerstrings dürfen nicht in der Antwort auftauchen.
      expect(found.affectedStopIds).toEqual([]);
      expect(found.affectedTripIds).toEqual([]);
      expect(found.affectedAgencyIds).toEqual([]);
    });
  });

  describe('Verbindungssuche', () => {
    it('findet die Direktverbindung Zürich HB → Basel SBB', async () => {
      const at = new Date(Date.now() - 15 * 60_000).toISOString();
      const response = await harness.server.inject({
        method: 'GET',
        url: `/v1/journeys/search?from=${TEST_STOPS.zurichHb.id}&to=${TEST_STOPS.baselSbb.id}&at=${encodeURIComponent(at)}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.provider).toBe('gtfs-direct');
      expect(body.journeys.length).toBeGreaterThan(0);
      expect(body.journeys[0].legs[0].routeShortName).toBe('IC 3');
      expect(body.journeys[0].transfers).toBe(0);
      // Die Einschränkung wird ehrlich mitgeliefert.
      expect(body.limitations[0]).toContain('Direktverbindungen');
    });
  });

  // --- App-Konfiguration -----------------------------------------------------

  describe('App-Konfiguration', () => {
    it('liefert Kategorien, Features und Schwellen in einem Aufruf', async () => {
      const response = await harness.server.inject({ method: 'GET', url: '/v1/app-config' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.categories.length).toBeGreaterThan(20);
      expect(body.features.community_reports).toBe(true);
      expect(body.detection.autoThreshold).toBe(0.9);
      expect(body.detection.confirmThreshold).toBe(0.7);
      expect(body.dataSources.timetable).toBe(true);
      // Ohne API-Key sind Echtzeitdaten ehrlich als nicht verfügbar markiert.
      expect(body.dataSources.realtime).toBe(false);
      expect(body.dataSources.journeyPlanner).toBe('gtfs-direct');
    });

    it('liefert den öffentlichen VAPID-Schlüssel — und niemals den privaten', () => {
      return harness.server
        .inject({ method: 'GET', url: '/v1/app-config' })
        .then((response) => {
          const body = response.json();
          expect(body.webPush).toBeDefined();
          // Ohne konfiguriertes Schlüsselpaar ist Push ehrlich als aus markiert.
          expect(body.webPush.enabled).toBe(false);
          expect(body.webPush.publicKey).toBeNull();
          // Der private Schlüssel darf unter KEINEN Umständen in der Antwort stehen.
          expect(JSON.stringify(body)).not.toContain('PRIVATE');
          expect(JSON.stringify(body)).not.toContain('privateKey');
        });
    });

    it('übernimmt administrative Änderungen an den Schwellen', async () => {
      const updated = await harness.server.inject({
        method: 'PUT',
        url: '/v1/admin/config/detection',
        headers: admin.authHeader,
        payload: {
          autoThreshold: 0.95,
          confirmThreshold: 0.65,
          defaultRadiusMeters: 1500,
          maxCandidates: 8,
          weights: {
            shapeDistance: 0.3,
            timeCompatibility: 0.25,
            directionCompatibility: 0.15,
            speedCompatibility: 0.1,
            stopSequence: 0.1,
            realtimeCompatibility: 0.1,
          },
        },
      });
      expect(updated.statusCode).toBe(200);

      const config = await harness.server.inject({ method: 'GET', url: '/v1/app-config' });
      expect(config.json().detection.autoThreshold).toBe(0.95);

      // Zurücksetzen, damit nachfolgende Tests die Standardwerte sehen.
      await harness.server.inject({
        method: 'PUT',
        url: '/v1/admin/config/detection',
        headers: admin.authHeader,
        payload: {
          autoThreshold: 0.9,
          confirmThreshold: 0.7,
          defaultRadiusMeters: 1200,
          maxCandidates: 8,
          weights: {
            shapeDistance: 0.3,
            timeCompatibility: 0.25,
            directionCompatibility: 0.15,
            speedCompatibility: 0.1,
            stopSequence: 0.1,
            realtimeCompatibility: 0.1,
          },
        },
      });
    });

    it('lehnt unplausible Konfigurationswerte ab', async () => {
      const response = await harness.server.inject({
        method: 'PUT',
        url: '/v1/admin/config/rateLimits',
        headers: admin.authHeader,
        payload: { reportsPerHour: -5 },
      });
      expect(response.statusCode).toBe(400);
    });

    it('schaltet Funktionen über Feature-Flags ab', async () => {
      await harness.server.inject({
        method: 'PATCH',
        url: '/v1/admin/feature-flags/community_reports',
        headers: admin.authHeader,
        payload: { enabled: false },
      });

      const blocked = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: user.authHeader,
        payload: { categoryKey: 'other', stopId: TEST_STOPS.zurichHb.id },
      });
      expect(blocked.statusCode).toBe(503);
      expect(blocked.json().error.code).toBe('FEATURE_DISABLED');

      await harness.server.inject({
        method: 'PATCH',
        url: '/v1/admin/feature-flags/community_reports',
        headers: admin.authHeader,
        payload: { enabled: true },
      });
    });
  });

  // --- Ablauf ----------------------------------------------------------------

  describe('Ablauf von Meldungen', () => {
    it('blendet abgelaufene Meldungen aus', async () => {
      const author = await harness.createUser();
      const created = await harness.server.inject({
        method: 'POST',
        url: '/v1/reports',
        headers: author.authHeader,
        payload: { categoryKey: 'ticket_inspection', stopId: TEST_STOPS.olten.id },
      });
      const reportId = created.json().report.id;

      // Meldung künstlich altern lassen. Die Prüfbedingung der Tabelle
      // verlangt expires_at > created_at, deshalb werden beide verschoben.
      await harness.db.query(
        `UPDATE public.reports
         SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
         WHERE id = $1`,
        [reportId],
      );

      const list = await harness.server.inject({
        method: 'GET',
        url: `/v1/reports?stopId=${TEST_STOPS.olten.id}&includeOfficial=false`,
        headers: otherUser.authHeader,
      });
      const ids = list.json().items.map((i: { id: string }) => i.id);
      expect(ids).not.toContain(reportId);
    });
  });
});

/** Startet eine Fahrt-Sitzung für den IC 3. */
async function startSession(
  harness: TestHarness,
  user: TestUser,
): Promise<{ id: string }> {
  const response = await harness.server.inject({
    method: 'POST',
    url: '/v1/trip-sessions',
    headers: user.authHeader,
    payload: {
      tripId: 't-ic3-1',
      serviceDate: harness.feed.serviceDate,
      confidence: 0.93,
      detectionMethod: 'AUTO_GPS',
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Sitzung konnte nicht gestartet werden: ${response.body}`);
  }
  return response.json().session;
}

export { secondsSinceMidnight };
