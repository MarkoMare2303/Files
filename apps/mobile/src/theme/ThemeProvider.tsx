import {
  MIN_TOUCH_TARGET,
  darkTheme,
  elevation,
  lightTheme,
  radius,
  spacing,
  typography,
  vehicleColors,
  type ThemeColors,
} from '@swissov/ui';
import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useSessionStore } from '../state/session.store.js';

/**
 * Design-System-Kontext (§29/§30).
 *
 * Die Tokens kommen aus `@swissov/ui` und werden von Mobile und Admin
 * gemeinsam genutzt. Dark Mode ist vollständig unterstützt und folgt
 * standardmässig der Systemeinstellung.
 */
export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
  vehicleColors: typeof vehicleColors;
  minTouchTarget: number;
  isDark: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const systemScheme = useColorScheme();
  const preference = useSessionStore((state) => state.themePreference);

  const isDark =
    preference === 'DARK' || (preference === 'SYSTEM' && systemScheme === 'dark');

  const value = useMemo<Theme>(
    () => ({
      colors: isDark ? darkTheme : lightTheme,
      spacing,
      radius,
      typography,
      elevation,
      vehicleColors,
      minTouchTarget: MIN_TOUCH_TARGET,
      isDark,
    }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme muss innerhalb von <ThemeProvider> verwendet werden');
  return theme;
}
