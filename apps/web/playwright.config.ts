import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright-Konfiguration (§E2E).
 *
 * Getestet wird gegen den PRODUKTIONS-Build (`next build && next start`), nicht
 * gegen den Dev-Server: nur dort greifen Service Worker, Sicherheits-Header und
 * die tatsächlichen Bundle-Grössen. Ein grüner Dev-Server sagt über die
 * ausgelieferte App wenig aus.
 *
 * Die Projekte bilden die realen Zielgeräte ab — mobile Viewports zuerst, denn
 * das Produkt ist Mobile-First. Desktop-Chromium läuft mit, weil die App auch
 * am Arbeitsplatz geöffnet wird.
 */
const PORT = Number(process.env.WEB_E2E_PORT ?? 3102);
const BASE_URL = process.env.WEB_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * In manchen CI-Images liegt ein vorinstalliertes Chromium, dessen Build-Nummer
 * nicht zur hier gepinnten Playwright-Version passt. `PLAYWRIGHT_CHROMIUM_PATH`
 * erlaubt es, genau dieses Binary zu verwenden, statt einen zweiten Download
 * zu erzwingen. Ohne die Variable gilt der Standardpfad von Playwright.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const chromiumLaunch = chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {};

export default defineConfig({
  testDir: './e2e',
  // Ein Test darf hängen bleiben, ohne die Pipeline zu blockieren.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    // Standort NICHT pauschal erlauben: die App muss den Fall „keine
    // Berechtigung" korrekt behandeln. Einzelne Tests erteilen ihn gezielt.
    permissions: [],
  },

  projects: [
    {
      name: 'iphone-safari',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'android-chrome',
      use: { ...devices['Pixel 7'], ...chromiumLaunch },
    },
    {
      name: 'firefox-mobile',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 390, height: 844 },
        isMobile: false, // Firefox unterstützt isMobile nicht.
        hasTouch: false,
      },
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
    },
  ],

  webServer: {
    command: `pnpm run build && pnpm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001',
      WEB_PORT: String(PORT),
    },
  },
});
