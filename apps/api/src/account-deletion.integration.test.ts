import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './test/harness.js';

/**
 * Kontolöschung in der Betriebsart „eigene PostgreSQL + Supabase nur für die
 * Anmeldung" (§23/§43, DSGVO Art. 17, CH-DSG).
 *
 * Diese Kombination ist ein eigener Fall, und zwar der, der in Produktion
 * geplant ist:
 *
 *   • Die Fahrplan- und Community-Daten liegen in einer eigenen PostgreSQL.
 *     Dort fehlt das Supabase-`auth`-Schema, also legt Migration 0002 den Shim
 *     `auth.users` an — nötig, weil `public.profiles.id` darauf verweist.
 *   • Die Nutzer selbst liegen bei Supabase. `SUPABASE_URL` und
 *     `SUPABASE_SERVICE_ROLE_KEY` sind gesetzt.
 *
 * Die bisherigen Tests liefen entweder ganz ohne Supabase (reiner Shim) oder
 * gedanklich ganz auf Supabase (echtes auth-Schema). Die Mischung — und damit
 * die geplante Produktionsumgebung — war nicht abgedeckt.
 *
 * Das Supabase-Auth-Admin-API wird durch einen lokalen HTTP-Server ersetzt:
 * geprüft werden soll das Verhalten dieser API, nicht die Erreichbarkeit von
 * Supabase.
 */
describe('Kontolöschung mit eigener Datenbank und Supabase-Anmeldung', () => {
  let harness: TestHarness;
  let stub: Server;
  const deleteRequests: string[] = [];

  beforeAll(async () => {
    stub = createServer((request, response) => {
      if (request.method === 'DELETE' && request.url?.startsWith('/auth/v1/admin/users/')) {
        deleteRequests.push(request.url.replace('/auth/v1/admin/users/', ''));
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const { port } = stub.address() as { port: number };

    harness = await createHarness({
      env: {
        SUPABASE_URL: `http://127.0.0.1:${port}`,
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-fuer-den-test',
      },
    });
  });

  afterAll(async () => {
    await harness?.close();
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
  });

  it('erkennt den lokalen Shim, obwohl Supabase konfiguriert ist', () => {
    // Grundlage der übrigen Erwartungen: die Datenbank ist die eigene, das
    // `auth`-Schema also der Shim — auch wenn die Anmeldung über Supabase läuft.
    expect(harness.ctx.authMode).toBe('shim');
  });

  it('legt im Shim keine E-Mail-Adresse ab', async () => {
    // Der Shim existiert allein, um den Fremdschlüssel von `profiles` zu
    // erfüllen. Die E-Mail wird von der Anwendung nirgends gelesen — das
    // Profil führt bewusst keine (§23). Sie trotzdem zu speichern, verlagert
    // personenbezogene Daten ohne Zweck in die eigene Datenbank.
    const user = await harness.createUserViaEnsure();

    const row = await harness.db.queryOne<{ email: string | null }>(
      'SELECT email FROM auth.users WHERE id = $1',
      [user.id],
    );
    expect(row).not.toBeNull();
    expect(row?.email).toBeNull();
  });

  it('entfernt bei der Löschung auch den Eintrag im Shim', async () => {
    const doomed = await harness.createUser();
    deleteRequests.length = 0;

    const response = await harness.server.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: doomed.authHeader,
      payload: { confirm: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().deleted).toBe(true);
    // Das Konto bei Supabase wurde gelöscht …
    expect(response.json().authAccountDeleted).toBe(true);
    expect(deleteRequests).toContain(doomed.id);

    // … und der Stub in der eigenen Datenbank ebenfalls. Vorher blieb er
    // stehen: der Zweig, der ihn entfernt, war ein `else if` zum
    // Supabase-Aufruf und damit genau dann unerreichbar, wenn Supabase
    // konfiguriert ist. Die Antwort meldete trotzdem „Konto und alle Daten
    // wurden gelöscht".
    const remaining = await harness.db.queryOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM auth.users WHERE id = $1',
      [doomed.id],
    );
    expect(remaining?.count).toBe(0);
  });

  it('meldet die Löschung nur, wenn sie auch stattgefunden hat', async () => {
    // Der Wortlaut „Konto und alle Daten wurden gelöscht" ist eine Zusage
    // gegenüber der betroffenen Person und darf nicht pauschal erscheinen.
    const doomed = await harness.createUser();
    const response = await harness.server.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: doomed.authHeader,
      payload: { confirm: true },
    });
    expect(response.json().note).toContain('gelöscht');

    const leftovers = await harness.db.queryOne<{ count: number }>(
      `SELECT (SELECT count(*) FROM auth.users WHERE id = $1)
            + (SELECT count(*) FROM public.profiles WHERE id = $1)
            + (SELECT count(*) FROM public.user_settings WHERE user_id = $1) AS count`,
      [doomed.id],
    );
    expect(leftovers?.count).toBe(0);
  });
});
