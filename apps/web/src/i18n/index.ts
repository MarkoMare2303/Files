import { de } from './de';
import { en } from './en';
import { fr } from './fr';
import { it } from './it';

/**
 * Internationalisierung (§45).
 *
 * Bewusst ohne Bibliothek: die App braucht nur Schlüssel-Lookup und einfache
 * Platzhalter. Deutsch ist vollständig, die anderen Sprachen fallen pro
 * fehlendem Schlüssel auf Deutsch zurück — nie auf einen rohen Schlüssel.
 *
 * Regel: keine UI-Texte direkt im JSX. Alles läuft über `t()`.
 */
export type TranslationKey = keyof typeof de;
export type Locale = 'de' | 'fr' | 'it' | 'en';

const CATALOGS: Record<Locale, Partial<Record<TranslationKey, string>>> = { de, fr, it, en };

export const SUPPORTED_LOCALES: Locale[] = ['de', 'fr', 'it', 'en'];

export const LOCALE_LABELS: Record<Locale, string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  en: 'English',
};

let activeLocale: Locale = 'de';

export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

/** Wählt aus einer Gerätesprachliste die erste unterstützte Sprache. */
export function resolveLocale(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    const short = candidate.toLowerCase().split('-')[0];
    if (short && SUPPORTED_LOCALES.includes(short as Locale)) return short as Locale;
  }
  return 'de';
}

/**
 * Übersetzt einen Schlüssel. Platzhalter werden als `{name}` geschrieben.
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: Locale = activeLocale,
): string {
  const template = CATALOGS[locale]?.[key] ?? de[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Wählt aus einem mehrsprachigen Serverobjekt den passenden Text. */
export function pick(
  text: { de: string; fr?: string; it?: string; en?: string } | null | undefined,
  locale: Locale = activeLocale,
): string {
  if (!text) return '';
  return text[locale] ?? text.de;
}
