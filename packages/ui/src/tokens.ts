/**
 * Design Tokens (§29/§30).
 *
 * Eigenständige Identität — bewusst weder SBB-Rot noch Google-Blau. Die
 * Grundfarbe ist ein tiefes, ruhiges Petrolblau („Perron"), dazu ein warmes
 * Signal-Orange, das ausschliesslich für die Melden-Aktion reserviert ist.
 * Dadurch ist die wichtigste Aktion der App immer sofort auffindbar.
 *
 * Die Tokens werden von Mobile (React Native) und Admin (Next.js/CSS)
 * gemeinsam genutzt, damit beide Oberflächen identisch aussehen.
 */

export const palette = {
  // Marke: „Perron" — tiefes Petrolblau
  brand: {
    50: '#EAF2F8',
    100: '#CBDFEE',
    200: '#9FC4DE',
    300: '#6BA4C9',
    400: '#3E84B2',
    500: '#1E6BAA',
    600: '#17558A',
    700: '#124169',
    800: '#0D2E4A',
    900: '#081D30',
  },
  // Signal: reserviert für die Melden-Aktion
  signal: {
    50: '#FFF3E9',
    100: '#FFE0C7',
    200: '#FFC194',
    300: '#FF9F5C',
    400: '#FF8A3D',
    500: '#F2701A',
    600: '#CC5A12',
    700: '#A0450D',
    800: '#73310A',
    900: '#4A1F06',
  },
  neutral: {
    0: '#FFFFFF',
    50: '#F7F8FA',
    100: '#EEF0F4',
    200: '#DFE3EA',
    300: '#C6CCD8',
    400: '#9AA3B2',
    500: '#6F7889',
    600: '#525B6B',
    700: '#3B4351',
    800: '#262C37',
    900: '#171B22',
    950: '#0E1116',
  },
  success: { 100: '#DFF3E6', 300: '#7FCB9C', 500: '#1F9D55', 700: '#146B3A' },
  // Der 700er-Schritt war ursprünglich #9B6F17 und damit deutlich heller als
  // die 700er-Schritte von success/danger. Als Textfarbe erreichte er nur
  // 4.49:1 auf Weiss — haarscharf an der AA-Grenze. Jetzt konsistent zur
  // übrigen Rampe und mit Reserve (5.4:1 auf Weiss, 4.8:1 auf warningSubtle).
  warning: { 100: '#FBF0D8', 300: '#EDC66B', 500: '#E0A32E', 700: '#8A6314' },
  danger: { 100: '#FBE3E5', 300: '#EC9AA1', 500: '#C6303C', 700: '#8A1F28' },
  info: { 100: '#E1F0F6', 300: '#8FC6DC', 500: '#3B8FB4', 700: '#256179' },
} as const;

/**
 * Semantische Farbrollen. Komponenten verwenden ausschliesslich diese Namen —
 * nie direkt Werte aus `palette`. Damit lässt sich das Erscheinungsbild an
 * einer Stelle ändern, ohne Komponenten anzufassen.
 */
export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textOnBrand: string;

  brand: string;
  brandStrong: string;
  brandSubtle: string;

  signal: string;
  signalStrong: string;
  signalSubtle: string;

  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;
  info: string;
  infoSubtle: string;

  /**
   * Quellenkennzeichnung (§7). `official` und `community` müssen sich nicht
   * nur im Farbton, sondern auch in der Helligkeit unterscheiden — sonst sind
   * sie bei Farbfehlsichtigkeit nicht auseinanderzuhalten.
   * `onOfficial`/`onCommunity` sind die zugehörigen Textfarben für Badges.
   */
  official: string;
  officialSubtle: string;
  onOfficial: string;
  community: string;
  communitySubtle: string;
  onCommunity: string;

  overlay: string;
  skeleton: string;
}

export const lightTheme: ThemeColors = {
  background: palette.neutral[50],
  surface: palette.neutral[0],
  surfaceElevated: palette.neutral[0],
  surfaceSunken: palette.neutral[100],
  border: palette.neutral[200],
  borderStrong: palette.neutral[300],

  textPrimary: palette.neutral[900],
  textSecondary: palette.neutral[600],
  textTertiary: palette.neutral[500],
  textInverse: palette.neutral[0],
  textOnBrand: palette.neutral[0],

  brand: palette.brand[500],
  brandStrong: palette.brand[700],
  brandSubtle: palette.brand[50],

  signal: palette.signal[400],
  signalStrong: palette.signal[600],
  signalSubtle: palette.signal[50],

  success: palette.success[500],
  successSubtle: palette.success[100],
  // Bewusst der 700er-Schritt, nicht der 500er: Warnfarben werden als TEXT
  // verwendet (Verspätungshinweise, Datenhinweise). #E0A32E erreicht auf Weiss
  // nur 2.2:1 und auf `warningSubtle` nur 2.0:1 — unlesbar. Gefunden durch den
  // Kontrasttest in `apps/web/src/components/source-badge.test.ts`.
  warning: palette.warning[700],
  warningSubtle: palette.warning[100],
  danger: palette.danger[500],
  dangerSubtle: palette.danger[100],
  info: palette.info[500],
  infoSubtle: palette.info[100],

  official: palette.brand[700],
  officialSubtle: palette.brand[50],
  onOfficial: '#FFFFFF',
  community: palette.signal[700],
  communitySubtle: palette.signal[50],
  onCommunity: '#FFFFFF',

  overlay: 'rgba(14, 17, 22, 0.45)',
  skeleton: palette.neutral[200],
};

export const darkTheme: ThemeColors = {
  background: palette.neutral[950],
  surface: palette.neutral[900],
  surfaceElevated: palette.neutral[800],
  surfaceSunken: '#0A0D11',
  border: '#2A313C',
  borderStrong: '#3B4351',

  textPrimary: '#F2F4F8',
  textSecondary: '#A8B0BF',
  textTertiary: '#79828F',
  textInverse: palette.neutral[900],
  textOnBrand: '#FFFFFF',

  brand: palette.brand[300],
  brandStrong: palette.brand[200],
  brandSubtle: '#10293D',

  signal: palette.signal[300],
  signalStrong: palette.signal[200],
  signalSubtle: '#3A2109',

  success: palette.success[300],
  successSubtle: '#10301F',
  warning: palette.warning[300],
  warningSubtle: '#332711',
  danger: '#F08A92',
  dangerSubtle: '#3A171B',
  info: palette.info[300],
  infoSubtle: '#122C38',

  official: palette.brand[100],
  officialSubtle: '#10293D',
  onOfficial: palette.brand[900],
  community: palette.signal[400],
  communitySubtle: '#3A2109',
  onCommunity: '#2A1405',

  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: '#2A313C',
};

/** 4-Punkt-Raster. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

/**
 * Typografie. Die Grössen sind Ausgangswerte — die App skaliert sie mit der
 * System-Schriftgrösse (§46 Dynamic Font Sizes).
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.5 },
  title1: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.3 },
  title2: { fontSize: 21, lineHeight: 27, fontWeight: '600' as const, letterSpacing: -0.2 },
  title3: { fontSize: 17, lineHeight: 23, fontWeight: '600' as const, letterSpacing: 0 },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const, letterSpacing: 0 },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' as const, letterSpacing: 0 },
  callout: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const, letterSpacing: 0 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: 0.1 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.2 },
  /** Für Abfahrtszeiten und Verspätungen — tabellarische Ziffern. */
  mono: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const, letterSpacing: 0.5 },
} as const;

/** Schattenstufen. Werte sind für React Native formuliert. */
export const elevation = {
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  sm: {
    shadowColor: '#0B1622',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#0B1622',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  lg: {
    shadowColor: '#0B1622',
    shadowOpacity: 0.16,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
} as const;

/** Mindestgrösse für Touch-Ziele (§46). */
export const MIN_TOUCH_TARGET = 44;

export const durations = {
  instant: 0,
  fast: 120,
  normal: 220,
  slow: 360,
} as const;

/** Farben je Verkehrsmittel — konsistent in Karte, Listen und Badges. */
export const vehicleColors: Record<string, string> = {
  RAIL: '#1E6BAA',
  SUBWAY: '#124169',
  TRAM: '#0E8A6E',
  BUS: '#B4553C',
  TROLLEYBUS: '#8A4A63',
  FERRY: '#3B8FB4',
  FUNICULAR: '#6F7B4F',
  AERIAL_LIFT: '#7A6FA8',
  CABLE_TRAM: '#6F7B4F',
  MONORAIL: '#124169',
  UNKNOWN: '#6F7889',
};

/** Erzeugt CSS-Custom-Properties für das Admin-Portal. */
export function themeToCssVariables(theme: ThemeColors): string {
  return Object.entries(theme)
    .map(([key, value]) => `  --color-${kebab(key)}: ${value};`)
    .join('\n');
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
