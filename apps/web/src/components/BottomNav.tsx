'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { t } from '../i18n/index';
import { cx } from './primitives';

/**
 * Untere Navigationsleiste (§28).
 *
 * Auf dem Telefon liegt der Daumen unten — die wichtigsten Ziele gehören
 * dorthin. Die Leiste ist fixiert und respektiert den Home-Indikator des
 * iPhones über `env(safe-area-inset-bottom)`.
 *
 * „Melden" sitzt in der Mitte und trägt als einzige Aktion die Signalfarbe.
 */
interface Item {
  href: string;
  labelKey: Parameters<typeof t>[0];
  icon: React.JSX.Element;
  emphasis?: boolean;
}

const ITEMS: Item[] = [
  { href: '/map', labelKey: 'tab.map', icon: <IconMap /> },
  { href: '/trips', labelKey: 'tab.trips', icon: <IconTrips /> },
  { href: '/report', labelKey: 'tab.report', icon: <IconReport />, emphasis: true },
  { href: '/reports', labelKey: 'tab.reports', icon: <IconList /> },
  { href: '/profile', labelKey: 'tab.profile', icon: <IconProfile /> },
];

export function BottomNav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Hauptnavigation"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-between px-xs">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                data-testid={`nav-${item.href.slice(1)}`}
                className={cx(
                  'flex min-h-[56px] flex-col items-center justify-center gap-xxs px-xs py-sm',
                  'text-[12px] font-medium leading-4 tracking-[0.2px] transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
                  item.emphasis
                    ? 'text-signal-strong'
                    : active
                      ? 'text-brand'
                      : 'text-text-tertiary hover:text-text-secondary',
                )}
              >
                <span
                  className={cx(
                    'flex h-6 w-6 items-center justify-center',
                    item.emphasis &&
                      'h-9 w-9 rounded-pill bg-signal text-on-community shadow-sm',
                  )}
                >
                  {item.icon}
                </span>
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* Icons sind bewusst inline: keine Zusatzbibliothek, keine Netzwerkanfrage,
   volle Kontrolle über Strichstärke und Farbe. */
function svgProps(): React.SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    width: 22,
    height: 22,
    'aria-hidden': true,
  };
}

function IconMap(): React.JSX.Element {
  return (
    <svg {...svgProps()}>
      <path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Z" />
      <path d="M9 3v15M15 6v15" />
    </svg>
  );
}

function IconTrips(): React.JSX.Element {
  return (
    <svg {...svgProps()}>
      <rect x="5" y="3" width="14" height="13" rx="3" />
      <path d="M5 10h14M8.5 19.5 6 22M15.5 19.5 18 22M9 16h6" />
      <circle cx="8.5" cy="13" r="0.8" fill="currentColor" />
      <circle cx="15.5" cy="13" r="0.8" fill="currentColor" />
    </svg>
  );
}

function IconReport(): React.JSX.Element {
  return (
    <svg {...svgProps()} strokeWidth={2}>
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

function IconList(): React.JSX.Element {
  return (
    <svg {...svgProps()}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function IconProfile(): React.JSX.Element {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}
