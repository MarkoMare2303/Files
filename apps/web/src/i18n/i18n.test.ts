import { describe, expect, it } from 'vitest';
import { de } from './de';
import { getLocale, pick, resolveLocale, setLocale, t } from './index';

/** Tests der Übersetzungsschicht (§45). */
describe('i18n', () => {
  it('liefert deutsche Texte', () => {
    setLocale('de');
    expect(t('tab.map')).toBe('Karte');
    expect(getLocale()).toBe('de');
  });

  it('ersetzt Platzhalter', () => {
    setLocale('de');
    expect(t('trip.delay', { minutes: 3 })).toBe('+3 Min.');
    expect(t('report.confirmations', { count: 5 })).toBe('5 Personen bestätigen');
  });

  it('lässt unbekannte Platzhalter unverändert', () => {
    setLocale('de');
    expect(t('trip.delay', {})).toBe('+{minutes} Min.');
  });

  it('fällt bei fehlender Übersetzung auf Deutsch zurück — nie auf den Schlüssel', () => {
    setLocale('it');
    // In der italienischen Teilübersetzung vorhanden:
    expect(t('tab.map')).toBe('Mappa');
    // Nicht vorhanden → deutscher Text, kein roher Schlüssel:
    expect(t('settings.deleteAccountConfirm')).toBe(de['settings.deleteAccountConfirm']);
    expect(t('settings.deleteAccountConfirm')).not.toContain('settings.');
    setLocale('de');
  });

  it('erkennt unterstützte Gerätesprachen', () => {
    expect(resolveLocale(['fr-CH', 'de-CH'])).toBe('fr');
    expect(resolveLocale(['rm-CH', 'it-CH'])).toBe('it');
    // Nicht unterstützte Sprachen führen zu Deutsch als Standard.
    expect(resolveLocale(['ja-JP'])).toBe('de');
    expect(resolveLocale([])).toBe('de');
  });

  it('wählt aus mehrsprachigen Servertexten die passende Sprache', () => {
    const text = { de: 'Störung', fr: 'Perturbation', it: 'Guasto' };
    expect(pick(text, 'fr')).toBe('Perturbation');
    // Fehlt die Sprache, greift Deutsch.
    expect(pick(text, 'en')).toBe('Störung');
    expect(pick(null)).toBe('');
  });

  it('enthält für jeden Schlüssel einen nicht-leeren deutschen Text', () => {
    const empty = Object.entries(de).filter(([, value]) => value.trim().length === 0);
    expect(empty).toEqual([]);
  });

  it('nennt in Konfigurationshinweisen die Variablen der PWA, nicht die der Expo-App', () => {
    // Zwei Meldungen verwiesen auf EXPO_PUBLIC_* — `auth.notConfigured` und
    // `map.noStyle`. Diese Variablen bewirken in der PWA nichts: sie liest
    // NEXT_PUBLIC_*. Wer die Meldung liest, füllt die falsche Zeile der .env
    // und die Anmeldung bzw. die Karte bleibt trotzdem aus (§55).
    const withExpoNames = Object.entries(de).filter(([, value]) => value.includes('EXPO_PUBLIC_'));
    expect(withExpoNames).toEqual([]);
  });
});
