import Link from 'next/link';
import React from 'react';
import { de } from '../../src/i18n/de';

/**
 * Offline-Ersatzseite.
 *
 * Der Service Worker liefert diese Seite aus, wenn eine Navigation
 * fehlschlägt und die Zielseite nicht im Cache liegt. Sie darf deshalb
 * keinerlei Netzwerkabhängigkeit haben — kein Bild, keine Schrift, kein Abruf.
 */
export const metadata = { title: 'Offline — ÖV Live' };

export default function OfflinePage(): React.JSX.Element {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-lg">
      <main id="main" className="flex max-w-md flex-col gap-lg text-center">
        <h1 className="text-[26px] font-bold leading-8 text-text-primary">
          {de['pwa.offlineTitle']}
        </h1>
        <p className="text-[16px] leading-[23px] text-text-secondary">{de['pwa.offlineBody']}</p>
        <Link
          href="/map"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border-strong bg-surface px-lg text-[16px] font-semibold text-text-primary"
        >
          {de['landing.cta']}
        </Link>
      </main>
    </div>
  );
}
