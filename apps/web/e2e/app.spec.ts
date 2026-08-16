import { expect, test } from '@playwright/test';
import { COMMUNITY_REPORT, goOffline, goOnline, mockApi } from './support/api-mock';

/**
 * End-to-End-Szenarien der PWA.
 *
 * Geprüft wird das, was Unit-Tests nicht können: echte Navigation, echter
 * Service Worker, echtes Offline-Verhalten, echte Sicherheits-Header.
 *
 * Alle Tests laufen gegen den Produktions-Build auf mobilen Viewports
 * (iPhone/WebKit, Pixel/Chromium, Firefox) — siehe playwright.config.ts.
 */

test.describe('1 — Landing-Page', () => {
  test('erklärt das Produkt und führt in die App', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Schweizer ÖV');
    // Die Herkunftsangabe ist Teil des Produktversprechens (§7) und darf nicht
    // im Zuge einer Umgestaltung verschwinden.
    await expect(page.getByText(/opentransportdata\.swiss/i)).toBeVisible();
    await expect(page.getByText(/kein Angebot der SBB/i)).toBeVisible();

    await page.getByRole('link', { name: /App öffnen/i }).click();
    await expect(page).toHaveURL(/\/map$/);
  });

  test('ist ohne JavaScript lesbar', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await context.close();
  });
});

test.describe('2 — Navigation', () => {
  test('die untere Leiste führt zu allen Hauptbereichen', async ({ page }) => {
    await mockApi(page);
    await page.goto('/map');

    for (const [testId, path] of [
      ['nav-trips', '/trips'],
      ['nav-report', '/report'],
      ['nav-reports', '/reports'],
      ['nav-profile', '/profile'],
      ['nav-map', '/map'],
    ] as const) {
      await page.getByTestId(testId).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });

  test('die aktive Seite ist für Screenreader markiert', async ({ page }) => {
    await mockApi(page);
    await page.goto('/reports');
    await expect(page.getByTestId('nav-reports')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-map')).not.toHaveAttribute('aria-current', 'page');
  });
});

test.describe('3 — Quellenkennzeichnung', () => {
  test('offizielle und Community-Meldungen sind unterscheidbar', async ({ page }) => {
    await mockApi(page);
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 47.3779, longitude: 8.5403 });
    await page.goto('/reports');

    const official = page.locator('[data-source="OFFICIAL"]').first();
    const community = page.locator('[data-source="COMMUNITY"]').first();

    await expect(official).toBeVisible();
    await expect(community).toBeVisible();

    // Beide tragen ein LESBARES Label — nicht nur eine Farbe (§7).
    await expect(official.getByText('Offizielle Meldung')).toBeVisible();
    await expect(community.getByText('Community-Meldung')).toBeVisible();
  });

  test('die Meldungsliste zeigt keine erfundenen Inhalte, wenn nichts vorliegt', async ({ page }) => {
    await mockApi(page, { reports: false });
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 47.3779, longitude: 8.5403 });
    await page.goto('/reports');

    await expect(page.locator('[data-testid="feed-item"]')).toHaveCount(0);
    await expect(page.getByText(/Keine Meldungen/i).first()).toBeVisible();
  });
});

test.describe('4 — Standort', () => {
  test('ohne Berechtigung wird erklärt statt blockiert', async ({ page }) => {
    await mockApi(page);
    await page.goto('/map');

    await expect(page.getByText('Standort aktivieren').first()).toBeVisible();
    // Die App bleibt bedienbar — die Navigation funktioniert weiterhin.
    await page.getByTestId('nav-reports').click();
    await expect(page).toHaveURL(/\/reports$/);
  });

  test('die Fahrtenseite sagt ehrlich, dass im Hintergrund nicht geortet wird', async ({ page }) => {
    await mockApi(page);
    await page.context().grantPermissions(['geolocation']);
    await page.context().setGeolocation({ latitude: 47.3779, longitude: 8.5403 });
    await page.goto('/trips');

    await expect(page.getByText(/nur, solange diese Seite geöffnet ist/i)).toBeVisible();
  });
});

test.describe('5 — Melden', () => {
  test('zeigt die Kategorien aus der Serverkonfiguration', async ({ page }) => {
    await mockApi(page);
    await page.goto('/report');

    await expect(page.getByTestId('category-TICKET_INSPECTION')).toBeVisible();
    await expect(page.getByTestId('category-DELAY')).toBeVisible();
    await expect(page.getByTestId('category-CROWDING')).toBeVisible();
  });

  test('weist im Gastmodus auf das nötige Konto hin', async ({ page }) => {
    await mockApi(page);
    await page.goto('/report');
    await expect(page.getByText(/brauchst du ein Konto/i)).toBeVisible();
  });

  test('das Freitextfeld begrenzt die Länge', async ({ page }) => {
    await mockApi(page);
    await page.goto('/report');

    const textarea = page.locator('textarea');
    await expect(textarea).toHaveAttribute('maxlength', '280');
    await textarea.fill('Kontrolle im hinteren Wagen');
    await expect(page.getByText('27 / 280')).toBeVisible();
  });
});

test.describe('6 — Fahrplan', () => {
  test('die Abfahrtstafel kennzeichnet die Datenquelle jeder Zeile', async ({ page }) => {
    await mockApi(page);
    await page.goto('/stop/8500218');

    await expect(page.getByRole('heading', { name: 'Olten' })).toBeVisible();
    // Ohne Echtzeitdaten steht das über der Liste — nicht versteckt.
    await expect(page.getByText(/Echtzeitdaten sind gerade nicht verfügbar/i)).toBeVisible();
    // Jede der drei Datenquellen muss als eigenes Badge erscheinen (§7).
    await expect(page.getByText('Fahrplan').first()).toBeVisible();
    await expect(page.getByText('Geschätzt').first()).toBeVisible();
    await expect(page.getByText('Live').first()).toBeVisible();
  });

  test('die Fahrtseite zeigt Halte, Verspätung und Quelle', async ({ page }) => {
    await mockApi(page);
    await page.goto('/trip/trip-ic3-1?serviceDate=2025-03-11');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('IC 3');
    await expect(page.getByText('Olten').first()).toBeVisible();
    await expect(page.getByText('Liestal').first()).toBeVisible();
    await expect(page.getByText('+2 Min.')).toBeVisible();
  });

  test('die Suche findet Haltestellen und führt zur Abfahrtstafel', async ({ page }) => {
    await mockApi(page);
    await page.goto('/search');

    await page.getByTestId('search-input').fill('Olten');
    await page.getByRole('button', { name: 'Olten' }).click();
    await expect(page).toHaveURL(/\/stop\/8500218$/);
  });
});

test.describe('7 — Push-Deep-Links', () => {
  test('eine Meldungs-URL aus einer Benachrichtigung öffnet die Meldung direkt', async ({ page }) => {
    await mockApi(page);
    await page.goto(`/reports/${COMMUNITY_REPORT.id}`);

    await expect(page.locator('[data-source="COMMUNITY"]')).toBeVisible();
    await expect(page.getByText('Kontrolle im vorderen Wagen.')).toBeVisible();
  });

  test('eine Fahrt-URL aus einer Benachrichtigung öffnet die Fahrt direkt', async ({ page }) => {
    await mockApi(page);
    await page.goto('/trip/trip-ic3-1?serviceDate=2025-03-11');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('IC 3');
  });
});

test.describe('8 — Offline', () => {
  test('zeigt einen Offline-Hinweis, statt still zu scheitern', async ({ page }) => {
    await mockApi(page);
    await page.goto('/reports');
    await expect(page.getByTestId('nav-reports')).toBeVisible();

    await goOffline(page);
    // `offline`-Ereignis auslösen und auf den Hinweis warten.
    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 15_000 });

    await goOnline(page);
    await expect(page.getByTestId('offline-banner')).toBeHidden({ timeout: 15_000 });
  });

  test('die Offline-Seite ist ohne Netz vollständig lesbar', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Keine Verbindung');
  });
});

test.describe('9 — PWA-Grundlagen', () => {
  test('das Manifest ist gültig und vollständig', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);

    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };

    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toContain('/map');
    // Ohne 192er und 512er Icon gilt eine PWA in Chrome nicht als installierbar.
    expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  test('alle im Manifest genannten Icons existieren wirklich', async ({ request }) => {
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
      icons: Array<{ src: string }>;
    };

    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} fehlt`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });

  test('der Service Worker wird registriert und übernimmt die Kontrolle', async ({
    page,
    browserName,
  }) => {
    // Firefox registriert Service Worker in Playwright-Kontexten nicht zuverlässig.
    test.skip(browserName === 'firefox', 'Service Worker in Firefox-Testkontext nicht verfügbar');

    await mockApi(page);
    await page.goto('/map');

    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active);
    });
    expect(registered).toBe(true);
  });

  test('der Service Worker selbst wird nie aus dem Cache ausgeliefert', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('die Startseite trägt alle Meta-Angaben für den Home-Bildschirm', async ({ page }) => {
    await mockApi(page);
    await page.goto('/map');

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    // Next.js gibt den standardisierten Namen aus; die apple-Variante ergänzen
    // wir selbst für iOS-Versionen vor 17.4.
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('link[rel="apple-touch-icon"]').first()).toHaveAttribute(
      'href',
      /apple-touch-icon/,
    );
    // Zoom muss erlaubt bleiben (§46).
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).not.toContain('user-scalable=no');
  });
});

test.describe('10 — Sicherheit', () => {
  test('die Sicherheits-Header sind gesetzt', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  test('das ausgelieferte JavaScript enthält keine Server-Geheimnisse', async ({ page }) => {
    await mockApi(page);

    const scripts: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/_next/static/') && response.url().endsWith('.js')) {
        scripts.push(response.url());
      }
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Muster, die niemals im Browser-Bundle stehen dürfen (§42).
    const forbidden = [
      'SUPABASE_SERVICE_ROLE_KEY',
      'WEB_PUSH_VAPID_PRIVATE_KEY',
      'API_INTERNAL_SECRET',
      'SUPABASE_JWT_SECRET',
      'OPENTRANSPORTDATA_API_KEY',
    ];

    for (const url of scripts.slice(0, 25)) {
      const body = await (await page.request.get(url)).text();
      for (const needle of forbidden) {
        expect(body, `${needle} in ${url}`).not.toContain(needle);
      }
    }
  });
});

test.describe('11 — Darstellung und Bedienbarkeit', () => {
  test('der Dunkelmodus wird übernommen', async ({ page }) => {
    await mockApi(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/map');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('die Seite scrollt auf dem Telefon nicht seitwärts', async ({ page }) => {
    await mockApi(page);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('Bedienelemente erfüllen die Mindestgrösse für Touch', async ({ page }) => {
    await mockApi(page);
    await page.goto('/report');

    const button = page.getByTestId('category-DELAY');
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('die App ist per Tastatur bedienbar', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Tab-Fokus folgt in WebKit anderen Regeln');

    await mockApi(page);
    await page.goto('/map');
    await page.keyboard.press('Tab');

    // Der erste Fokus liegt auf dem Sprunglink — die Voraussetzung dafür,
    // dass Screenreader-Nutzer die Navigation überspringen können.
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(focused).toContain('Zum Inhalt springen');
  });
});
