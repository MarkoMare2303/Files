'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { config } from '../config';
import { useAppConfig } from '../api/hooks';
import { isIosSafari, isStandalone } from '../pwa/useInstallPrompt';
import { useSessionStore } from '../state/session.store';

/**
 * Web Push (§24, ersetzt Expo Push).
 *
 * Der Weg ist: Service Worker registriert → `PushManager.subscribe()` mit dem
 * öffentlichen VAPID-Schlüssel → Abo (Endpunkt + zwei Schlüssel) an die API.
 * Der private VAPID-Schlüssel liegt ausschliesslich im Worker-Prozess und
 * erreicht den Browser nie.
 *
 * Die wichtigste Ehrlichkeit hier betrifft iOS: Push funktioniert dort NUR in
 * einer installierten PWA (iOS ≥ 16.4). Im Safari-Tab existiert
 * `window.PushManager` gar nicht. Statt eines toten Schalters zeigt die App
 * den Grund an.
 */
export type PushBlocker =
  | 'UNSUPPORTED'
  | 'NEEDS_INSTALL_IOS'
  | 'PERMISSION_DENIED'
  | 'NOT_SIGNED_IN'
  | 'SERVER_DISABLED'
  | null;

export interface PushState {
  supported: boolean;
  subscribed: boolean;
  busy: boolean;
  blocker: PushBlocker;
  subscribe(): Promise<boolean>;
  unsubscribe(): Promise<void>;
}

/**
 * VAPID-Schlüssel kommen base64url-kodiert und müssen als Bytes übergeben
 * werden.
 *
 * Der `ArrayBuffer` wird explizit vorab angelegt: `PushSubscriptionOptions`
 * verlangt eine `BufferSource` über einem echten `ArrayBuffer`, während
 * `new Uint8Array(n)` typseitig auch ein `SharedArrayBuffer` sein könnte.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function usePushSubscription(): PushState {
  const signedIn = useSessionStore((state) => state.accessToken !== null);
  const ensureInstallId = useSessionStore((state) => state.ensureInstallId);
  const appConfig = useAppConfig();

  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const publicKey = appConfig.data?.webPush?.publicKey ?? null;
  const serverEnabled = appConfig.data?.webPush?.enabled ?? false;

  useEffect(() => {
    if (!pushSupported()) return;
    setSupported(true);
    setDenied(Notification.permission === 'denied');

    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setSubscribed(subscription !== null))
      .catch(() => setSubscribed(false));
  }, []);

  const blocker: PushBlocker = !supported
    ? isIosSafari() && !isStandalone()
      ? 'NEEDS_INSTALL_IOS'
      : 'UNSUPPORTED'
    : !serverEnabled || !publicKey
      ? 'SERVER_DISABLED'
      : !signedIn
        ? 'NOT_SIGNED_IN'
        : denied
          ? 'PERMISSION_DENIED'
          : null;

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!pushSupported() || !publicKey || !signedIn) return false;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setDenied(permission === 'denied');
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Ohne `userVisibleOnly` verweigern alle Browser das Abo — und es
          // entspricht unserer Regel: jede Push führt zu einer sichtbaren
          // Benachrichtigung, nie zu stillem Hintergrundverhalten.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
        expirationTime?: number | null;
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;

      await api.registerPushSubscription({
        installId: ensureInstallId(),
        subscription: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          expirationTime: json.expirationTime ?? null,
        },
        // Nur die grobe Browserkennung — sie hilft beim Einordnen von
        // Zustellfehlern. Keine Standort- oder Kontodaten (§23).
        userAgent: navigator.userAgent.slice(0, 200),
      });

      setSubscribed(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [ensureInstallId, publicKey, signedIn]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!pushSupported()) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setSubscribed(false);
        return;
      }
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      // Serverseitig abmelden — sonst versendet der Worker weiter ins Leere.
      try {
        await api.removePushSubscription(endpoint);
      } catch {
        // Der Endpunkt ist im Browser bereits weg; der Worker räumt beim
        // nächsten 404/410 selbst auf.
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported: supported && Boolean(config.apiUrl), subscribed, busy, blocker, subscribe, unsubscribe };
}
