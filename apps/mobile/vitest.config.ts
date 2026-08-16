import { defineConfig } from 'vitest/config';

/**
 * Unit-Tests der App-Logik.
 *
 * Getestet wird ausschliesslich reiner TypeScript-Code (Offline-Queue,
 * i18n, API-Client). Komponententests mit React-Native-Runtime brauchen
 * einen nativen Testrunner und laufen im E2E-Setup (siehe docs/architecture.md).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
