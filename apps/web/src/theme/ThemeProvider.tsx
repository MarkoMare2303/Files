'use client';

import { darkTheme, lightTheme, type ThemeColors } from '@swissov/ui';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '../state/session.store';

/**
 * Theme im Browser (§30/§46).
 *
 * Die Farben stehen als CSS-Variablen am `<html>`-Element — Tailwind greift
 * über `var(--color-…)` darauf zu. Dadurch braucht keine Komponente eine
 * Hell-/Dunkel-Fallunterscheidung.
 *
 * `data-theme` wird zusätzlich gesetzt, damit CSS ohne JavaScript-Kontext
 * (z. B. die Karte) den aktiven Modus kennt.
 */
type Resolved = 'light' | 'dark';

interface ThemeContextValue {
  colors: ThemeColors;
  resolved: Resolved;
}

const ThemeContext = createContext<ThemeContextValue>({ colors: lightTheme, resolved: 'light' });

/** Der Browser-Chrome soll die Kopfzeilenfarbe der App übernehmen. */
function applyThemeColorMeta(color: string): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const preference = useSessionStore((state) => state.themePreference);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(query.matches);
    const listener = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  const resolved: Resolved =
    preference === 'DARK' ? 'dark' : preference === 'LIGHT' ? 'light' : systemDark ? 'dark' : 'light';

  const colors = resolved === 'dark' ? darkTheme : lightTheme;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(colors)) {
      root.style.setProperty(`--color-${kebab(key)}`, value);
    }
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    applyThemeColorMeta(colors.surface);
  }, [colors, resolved]);

  const value = useMemo<ThemeContextValue>(() => ({ colors, resolved }), [colors, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
