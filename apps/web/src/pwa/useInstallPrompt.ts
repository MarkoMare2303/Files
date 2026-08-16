'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../state/session.store';

/**
 * Installations-UX (§PWA).
 *
 * Zwei völlig verschiedene Welten:
 *   • Chromium (Android, Desktop): feuert `beforeinstallprompt`. Wir fangen
 *     das Ereignis ab und zeigen die Einladung dort, wo sie passt — nicht
 *     mitten in einer Meldung.
 *   • iOS-Safari: kein Ereignis, keine API. Nur eine Anleitung („Teilen →
 *     Zum Home-Bildschirm"). Alles andere wäre gelogen.
 *
 * Nicht nerven: nach dem Wegklicken 14 Tage Ruhe, gespeichert im
 * Sitzungs-Store. Ist die App bereits installiert, wird nie gefragt.
 */
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMethod = 'PROMPT' | 'IOS_MANUAL' | 'NONE';

export interface InstallState {
  /** Läuft die App bereits als installierte PWA? */
  installed: boolean;
  /** Wie kann installiert werden? */
  method: InstallMethod;
  /** Soll die Einladung jetzt gezeigt werden? */
  shouldOffer: boolean;
  /** Löst den nativen Dialog aus (nur bei `method === 'PROMPT'`). */
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  dismiss(): void;
}

/** Läuft das Dokument im Standalone-Modus (also installiert)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia?.('(display-mode: standalone)').matches === true || iosStandalone === true;
}

/** iOS-Safari erkennen — inklusive iPadOS, das sich als Mac ausgibt. */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  // Chrome/Firefox auf iOS können nicht installieren (kein „Zum Home-Bildschirm").
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function useInstallPrompt(): InstallState {
  const dismissedAt = useSessionStore((state) => state.installPromptDismissedAt);
  const dismissStore = useSessionStore((state) => state.dismissInstallPrompt);

  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosManual, setIosManual] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    setInstalled(isStandalone());
    setIosManual(isIosSafari() && !isStandalone());

    const onBeforeInstall = (event: Event): void => {
      // Ohne `preventDefault` zeigt Chrome eine eigene Mini-Leiste an einer
      // Stelle, die wir nicht kontrollieren.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    const onInstalled = (): void => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const method: InstallMethod = installed
    ? 'NONE'
    : deferred
      ? 'PROMPT'
      : iosManual
        ? 'IOS_MANUAL'
        : 'NONE';

  const snoozed = dismissedAt !== null && Date.now() - dismissedAt < SNOOZE_MS;

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // Das Ereignis ist verbraucht — Chrome liefert bei Bedarf ein neues.
    setDeferred(null);
    if (outcome === 'dismissed') dismissStore();
    return outcome;
  }, [deferred, dismissStore]);

  return {
    installed,
    method,
    shouldOffer: method !== 'NONE' && !snoozed,
    install,
    dismiss: () => dismissStore(),
  };
}
