import { beforeEach, describe, expect, it } from 'vitest';
import { generateId, useSessionStore } from './session.store';

/**
 * Tests des Sitzungs-Stores (§21/§23/§42).
 *
 * Zwei Zusicherungen stehen im Vordergrund:
 *   • Das Zugriffstoken wird NICHT persistiert.
 *   • Die Installations-ID ist eine App-ID — kein Geräte-Fingerabdruck.
 */
beforeEach(() => {
  window.localStorage.clear();
  useSessionStore.setState({
    accessToken: null,
    profile: null,
    settings: null,
    activeTrip: null,
    installId: null,
    installPromptDismissedAt: null,
    onboardingCompleted: false,
    locationPermission: 'unknown',
    locale: 'de',
    themePreference: 'SYSTEM',
  });
});

describe('generateId', () => {
  it('erzeugt eine UUID der Version 4', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('erzeugt bei jedem Aufruf einen anderen Wert', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateId()));
    expect(ids.size).toBe(200);
  });
});

describe('Installations-ID', () => {
  it('wird beim ersten Zugriff erzeugt und danach wiederverwendet', () => {
    const first = useSessionStore.getState().ensureInstallId();
    const second = useSessionStore.getState().ensureInstallId();
    expect(first).toBe(second);
    expect(useSessionStore.getState().installId).toBe(first);
  });
});

describe('Persistenz', () => {
  it('speichert das Zugriffstoken NICHT im localStorage', () => {
    useSessionStore.getState().setAuth('geheimes-token', null);
    useSessionStore.getState().completeOnboarding();

    const raw = window.localStorage.getItem('swissov-session') ?? '';
    expect(raw).not.toContain('geheimes-token');
    // Der Rest wird sehr wohl gespeichert.
    expect(raw).toContain('onboardingCompleted');
  });

  it('speichert kein Profil und keine Einstellungen', () => {
    useSessionStore.getState().setAuth('token', {
      id: '11111111-2222-4333-8444-555555555555',
      alias: 'Blaues Tram',
    } as never);

    const raw = window.localStorage.getItem('swissov-session') ?? '';
    expect(raw).not.toContain('Blaues Tram');
  });
});

describe('Abmelden', () => {
  it('entfernt Token, Profil, Einstellungen und aktive Fahrt', () => {
    useSessionStore.getState().setAuth('token', { alias: 'X' } as never);
    useSessionStore.getState().setActiveTrip({ id: 'session-1' } as never);

    useSessionStore.getState().signOut();

    const state = useSessionStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.settings).toBeNull();
    expect(state.activeTrip).toBeNull();
  });

  it('behält Präferenzen — sie gehören dem Gerät, nicht dem Konto', () => {
    useSessionStore.getState().setThemePreference('DARK');
    useSessionStore.getState().completeOnboarding();
    useSessionStore.getState().signOut();

    expect(useSessionStore.getState().themePreference).toBe('DARK');
    expect(useSessionStore.getState().onboardingCompleted).toBe(true);
  });
});

describe('Einstellungen übernehmen', () => {
  it('übernimmt Sprache und Theme aus den Serverwerten', () => {
    useSessionStore.getState().setSettings({
      locale: 'fr',
      theme: 'DARK',
      notifications: {},
    } as never);

    expect(useSessionStore.getState().locale).toBe('fr');
    expect(useSessionStore.getState().themePreference).toBe('DARK');
  });

  it('behält die lokale Wahl, wenn der Server nichts liefert', () => {
    useSessionStore.getState().setLocale('it');
    useSessionStore.getState().setSettings(null);
    expect(useSessionStore.getState().locale).toBe('it');
  });
});

describe('Installations-Einladung', () => {
  it('merkt sich den Zeitpunkt des Wegklickens', () => {
    const before = Date.now();
    useSessionStore.getState().dismissInstallPrompt();
    expect(useSessionStore.getState().installPromptDismissedAt).toBeGreaterThanOrEqual(before);
  });
});
