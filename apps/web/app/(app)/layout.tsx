import React from 'react';
import { AppShell } from '../../src/components/AppShell';

/**
 * Hülle aller App-Routen.
 *
 * Die Landing-Page unter `/` liegt bewusst ausserhalb dieser Gruppe: sie soll
 * ohne Navigationsleiste, ohne Standortabfrage und ohne angemeldeten Zustand
 * funktionieren.
 */
export default function AppLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <AppShell>{children}</AppShell>;
}
