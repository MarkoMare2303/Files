import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest für die PWA.
 *
 * `jsdom` reicht für die Logik-Tests: Hooks, Speicher, Übersetzungen und
 * Kontrastwerte. Alles, was einen echten Browser braucht (Service Worker,
 * Push, Installation, Karte), wird in Playwright geprüft — dort läuft echtes
 * Chromium/WebKit/Firefox statt einer Nachbildung.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Playwright bringt eigene Runner mit — sonst würde vitest sie einsammeln.
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
    restoreMocks: true,
  },
});
