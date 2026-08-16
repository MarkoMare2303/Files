import { darkTheme, lightTheme, type ThemeColors } from '@swissov/ui';
import { describe, expect, it } from 'vitest';
import { departureSource } from './SourceBadge';

/**
 * Die Quellenkennzeichnung ist die wichtigste Zusicherung der App (§7):
 * Offizielle Meldungen und Community-Beobachtungen dürfen NIE verwechselbar
 * sein — auch nicht bei Farbfehlsichtigkeit, auch nicht im Dunkelmodus.
 *
 * Diese Tests prüfen die Farbwerte rechnerisch. Sie haben in der nativen App
 * bereits einen echten Fehler gefunden (weisse Schrift auf hellblauem Badge)
 * und gehören deshalb in jede Oberfläche, die diese Tokens verwendet.
 */
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

const themes: Array<{ name: string; theme: ThemeColors }> = [
  { name: 'hell', theme: lightTheme },
  { name: 'dunkel', theme: darkTheme },
];

describe.each(themes)('Quellen-Badges im $name Modus', ({ theme }) => {
  it('Text auf dem Offiziell-Badge erfüllt WCAG AA (4.5:1)', () => {
    expect(contrastRatio(theme.onOfficial, theme.official)).toBeGreaterThanOrEqual(4.5);
  });

  it('Text auf dem Community-Badge erfüllt WCAG AA (4.5:1)', () => {
    expect(contrastRatio(theme.onCommunity, theme.community)).toBeGreaterThanOrEqual(4.5);
  });

  it('Offiziell und Community unterscheiden sich deutlich in der Helligkeit', () => {
    // Farbe allein genügt nicht: bei Deuteranopie sind Blau und Orange im
    // Farbton kaum trennbar, in der Helligkeit aber schon.
    expect(contrastRatio(theme.official, theme.community)).toBeGreaterThanOrEqual(1.6);
  });

  it('beide Badges heben sich von der Kartenfläche ab', () => {
    expect(contrastRatio(theme.official, theme.surface)).toBeGreaterThanOrEqual(2);
    expect(contrastRatio(theme.community, theme.surface)).toBeGreaterThanOrEqual(2);
  });

  it('Fliesstext erfüllt WCAG AA auf der Kartenfläche', () => {
    expect(contrastRatio(theme.textPrimary, theme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.textSecondary, theme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('Statusfarben sind auf ihrer eigenen Fläche lesbar', () => {
    expect(contrastRatio(theme.success, theme.successSubtle)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(theme.warning, theme.warningSubtle)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(theme.danger, theme.dangerSubtle)).toBeGreaterThanOrEqual(3);
  });
});

describe('departureSource', () => {
  it('meldet LIVE nur bei echter Echtzeitzeit des Betriebs', () => {
    expect(departureSource({ realtimeDeparture: '2025-03-11T17:35:00Z', delaySeconds: 60 })).toBe(
      'REALTIME',
    );
  });

  it('meldet GESCHÄTZT, wenn nur eine Verspätung bekannt ist', () => {
    expect(departureSource({ realtimeDeparture: null, delaySeconds: 120 })).toBe('ESTIMATED');
  });

  it('meldet FAHRPLAN, wenn keine Echtzeitdaten vorliegen', () => {
    expect(departureSource({ realtimeDeparture: null, delaySeconds: null })).toBe('SCHEDULED');
  });

  it('behandelt fehlende Felder wie fehlende Echtzeitdaten', () => {
    expect(departureSource({})).toBe('SCHEDULED');
  });
});
