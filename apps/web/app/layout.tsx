import type { Metadata, Viewport } from 'next';
import React from 'react';
import { Providers } from '../src/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ÖV Live — Schweizer öffentlicher Verkehr',
  description:
    'Fahrplan, Echtzeitdaten und Community-Meldungen für Zug, S-Bahn, Tram, Bus und PostAuto in der ganzen Schweiz.',
  applicationName: 'ÖV Live',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // Erzeugt `<meta name="mobile-web-app-capable" content="yes">`.
    capable: true,
    title: 'ÖV Live',
    // `default` behält die Statusleiste lesbar — `black-translucent` würde den
    // Inhalt darunter schieben und die Uhrzeit verdecken.
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom bleibt erlaubt — eine App, die man nicht vergrössern kann, ist für
  // sehbehinderte Menschen unbrauchbar (§46).
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#171B22' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-md focus:top-md focus:z-50 focus:rounded-md focus:bg-surface focus:px-lg focus:py-md"
        >
          Zum Inhalt springen
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
