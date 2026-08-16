import { radius, spacing, typography } from '@swissov/ui';
import type { Config } from 'tailwindcss';

/**
 * Tailwind bekommt die Design-Tokens aus `@swissov/ui`.
 *
 * Farben verweisen bewusst auf CSS-Variablen statt auf feste Werte: dieselbe
 * Utility-Klasse funktioniert dadurch in hellem und dunklem Modus, ohne dass
 * jede Komponente zwei Varianten braucht.
 */
const color = (name: string) => `var(--color-${name})`;

const px = (value: number): string => `${value}px`;

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: color('background'),
        surface: color('surface'),
        'surface-elevated': color('surface-elevated'),
        'surface-sunken': color('surface-sunken'),
        border: color('border'),
        'border-strong': color('border-strong'),

        'text-primary': color('text-primary'),
        'text-secondary': color('text-secondary'),
        'text-tertiary': color('text-tertiary'),
        'text-inverse': color('text-inverse'),
        'text-on-brand': color('text-on-brand'),

        brand: color('brand'),
        'brand-strong': color('brand-strong'),
        'brand-subtle': color('brand-subtle'),

        signal: color('signal'),
        'signal-strong': color('signal-strong'),
        'signal-subtle': color('signal-subtle'),

        success: color('success'),
        'success-subtle': color('success-subtle'),
        warning: color('warning'),
        'warning-subtle': color('warning-subtle'),
        danger: color('danger'),
        'danger-subtle': color('danger-subtle'),
        info: color('info'),
        'info-subtle': color('info-subtle'),

        official: color('official'),
        'official-subtle': color('official-subtle'),
        'on-official': color('on-official'),
        community: color('community'),
        'community-subtle': color('community-subtle'),
        'on-community': color('on-community'),

        overlay: color('overlay'),
        skeleton: color('skeleton'),
      },
      spacing: Object.fromEntries(
        Object.entries(spacing).map(([key, value]) => [key, px(value)]),
      ) as Record<string, string>,
      borderRadius: Object.fromEntries(
        Object.entries(radius).map(([key, value]) => [
          key,
          value === 999 ? '9999px' : px(value as number),
        ]),
      ) as Record<string, string>,
      fontSize: Object.fromEntries(
        Object.entries(typography).map(([key, value]) => [
          key,
          [px(value.fontSize), { lineHeight: px(value.lineHeight), fontWeight: value.fontWeight }],
        ]),
      ) as Record<string, [string, { lineHeight: string; fontWeight: string }]>,
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
