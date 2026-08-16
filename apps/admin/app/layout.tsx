import { darkTheme, lightTheme, themeToCssVariables } from '@swissov/ui';
import type { Metadata } from 'next';
import React from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ÖV Live — Administration',
  description: 'Moderation und Administration der Schweizer ÖV Live Community App',
  robots: { index: false, follow: false },
};

/**
 * Die Design Tokens werden als CSS-Variablen ausgeliefert — inklusive Dark
 * Mode über `prefers-color-scheme` (§30).
 */
const themeCss = `
:root {
${themeToCssVariables(lightTheme)}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
${themeToCssVariables(darkTheme)}
    color-scheme: dark;
  }
}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="de">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
