import { describe, expect, it } from 'vitest';
import {
  MIN_TOUCH_TARGET,
  darkTheme,
  lightTheme,
  radius,
  spacing,
  themeToCssVariables,
  typography,
  vehicleColors,
} from './tokens.js';

/**
 * Tests des Design Systems (§30/§46).
 *
 * Der wichtigste Test ist der Kontrast: unzureichende Kontraste sind ein
 * Barrierefreiheitsfehler, der sich visuell leicht übersehen lässt.
 */

/** Relative Luminanz nach WCAG 2.1. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Themes', () => {
  it('definiert im Dark Mode dieselben Rollen wie im Light Mode', () => {
    expect(Object.keys(darkTheme).sort()).toEqual(Object.keys(lightTheme).sort());
  });

  it('verwendet in beiden Themes unterschiedliche Hintergründe', () => {
    expect(lightTheme.background).not.toBe(darkTheme.background);
    expect(lightTheme.surface).not.toBe(darkTheme.surface);
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('erfüllt in %s die WCAG-AA-Kontraste für Fliesstext', (_name, theme) => {
    // AA verlangt 4.5:1 für normalen Text.
    expect(contrastRatio(theme.textPrimary, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.textPrimary, theme.surface)).toBeGreaterThanOrEqual(4.5);
    // Sekundärtext darf etwas schwächer sein, muss aber AA für grossen Text erfüllen.
    expect(contrastRatio(theme.textSecondary, theme.background)).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('hebt in %s offizielle und Community-Quellen farblich voneinander ab', (_name, theme) => {
    // Die Quellenkennzeichnung darf nicht allein durch Text erfolgen (§7),
    // deshalb müssen sich die Farben deutlich unterscheiden.
    expect(theme.official).not.toBe(theme.community);
    expect(contrastRatio(theme.official, theme.community)).toBeGreaterThan(1.4);
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('macht die Quellen-Badges in %s lesbar', (_name, theme) => {
    // Badge-Text ist klein (caption) — AA verlangt hier 4.5:1.
    expect(contrastRatio(theme.onOfficial, theme.official)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.onCommunity, theme.community)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.official, theme.officialSubtle)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(theme.community, theme.communitySubtle)).toBeGreaterThanOrEqual(3);
  });

  it('erzeugt CSS-Variablen für jede Farbrolle', () => {
    const css = themeToCssVariables(lightTheme);
    expect(css).toContain('--color-background:');
    expect(css).toContain('--color-text-primary:');
    expect(css).toContain('--color-official:');
    expect(css.split('\n')).toHaveLength(Object.keys(lightTheme).length);
  });
});

describe('Abstände und Typografie', () => {
  it('folgt einem 4-Punkt-Raster', () => {
    for (const [name, value] of Object.entries(spacing)) {
      if (name === 'xxs') continue; // bewusste Ausnahme für Feinabstimmung
      expect(value % 4).toBe(0);
    }
  });

  it('hat eine monoton fallende Schriftgrössen-Skala', () => {
    const sizes = [
      typography.display.fontSize,
      typography.title1.fontSize,
      typography.title2.fontSize,
      typography.title3.fontSize,
      typography.body.fontSize,
      typography.footnote.fontSize,
      typography.caption.fontSize,
    ];
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]!).toBeLessThan(sizes[i - 1]!);
    }
  });

  it('hält Zeilenhöhen über der Schriftgrösse', () => {
    for (const style of Object.values(typography)) {
      expect(style.lineHeight).toBeGreaterThan(style.fontSize);
    }
  });

  it('erfüllt die Mindestgrösse für Touch-Ziele', () => {
    // Apple: 44 pt, Android: 48 dp — 44 ist die gemeinsame Untergrenze.
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });

  it('definiert aufsteigende Radien', () => {
    expect(radius.sm).toBeLessThan(radius.md);
    expect(radius.md).toBeLessThan(radius.lg);
    expect(radius.lg).toBeLessThan(radius.xl);
  });
});

describe('Fahrzeugfarben', () => {
  it('deckt alle Verkehrsmittel ab und nutzt gültige Hex-Werte', () => {
    const expected = [
      'RAIL',
      'SUBWAY',
      'TRAM',
      'BUS',
      'TROLLEYBUS',
      'FERRY',
      'FUNICULAR',
      'AERIAL_LIFT',
      'CABLE_TRAM',
      'MONORAIL',
      'UNKNOWN',
    ];
    for (const key of expected) {
      expect(vehicleColors[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('kontrastiert ausreichend mit weisser Schrift auf dem Badge', () => {
    for (const [name, color] of Object.entries(vehicleColors)) {
      // Badges zeigen weisse Kurzbezeichnungen — mind. 3:1 für grossen Text.
      expect(contrastRatio('#FFFFFF', color), name).toBeGreaterThanOrEqual(3);
    }
  });
});
