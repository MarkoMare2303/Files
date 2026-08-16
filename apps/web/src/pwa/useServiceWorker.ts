'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Registrierung und Aktualisierung des Service Workers.
 *
 * Der heikle Teil ist das Update: ein neuer Worker bleibt nach der
 * Installation im Zustand „waiting", bis alle Seiten der alten Version
 * geschlossen sind. Bei einer App, die man nie schliesst, wäre das nie.
 *
 * Deshalb: sobald ein wartender Worker existiert, wird der Nutzer gefragt.
 * Erst auf seine Bestätigung hin übernimmt der neue Worker (`SKIP_WAITING`)
 * und die Seite lädt genau einmal neu. Kein stiller Neustart mitten in einer
 * Meldung.
 */
export interface ServiceWorkerState {
  supported: boolean;
  registered: boolean;
  /** Eine neue Version ist installiert und wartet. */
  updateAvailable: boolean;
  /** Übernimmt die neue Version und lädt die Seite neu. */
  applyUpdate(): void;
}

export function useServiceWorker(): ServiceWorkerState {
  const [supported, setSupported] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    setSupported(true);

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;

    const trackWaiting = (reg: ServiceWorkerRegistration): void => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
    };

    const onUpdateFound = (): void => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // `controller` ist null beim allerersten Besuch — dann ist das kein
        // Update, sondern die Erstinstallation. Da fragt man nicht.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          setWaiting(installing);
        }
      });
    };

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        setRegistered(true);
        trackWaiting(reg);
        reg.addEventListener('updatefound', onUpdateFound);
        // Beim Zurückkehren auf den Tab nach neuen Versionen sehen.
        void reg.update();
      })
      .catch(() => {
        // Ohne Service Worker bleibt die App vollständig benutzbar — nur
        // offline nicht. Kein Grund für eine Fehlermeldung.
      });

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void registration?.update();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      registration?.removeEventListener('updatefound', onUpdateFound);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    // Genau einmal neu laden, wenn der neue Worker die Kontrolle übernimmt.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  return { supported, registered, updateAvailable: waiting !== null, applyUpdate };
}
