/* eslint-env serviceworker */
/* global clients */

/**
 * Service Worker der ÖV-Live-PWA.
 *
 * Drei Aufgaben:
 *   1. Offlinefähigkeit — die App startet auch ohne Netz.
 *   2. Web Push — Benachrichtigungen anzeigen und Deep-Links öffnen.
 *   3. Kontrollierte Aktualisierung — neue Versionen erst auf Zustimmung.
 *
 * Bewusst ohne Build-Werkzeug (kein Workbox): der Worker ist die letzte
 * Instanz zwischen Nutzer und Netz. Er soll lesbar bleiben und keine
 * Abhängigkeit haben, die man nicht selbst überblickt.
 *
 * WICHTIG — Caching-Regel:
 * Es werden ausschliesslich statische Ressourcen der App zwischengespeichert.
 * API-Antworten werden NIE gecacht: sie sind nutzerbezogen (Bearer-Token) und
 * ein geteilter Cache auf einem Familientablet würde fremde Meldungen,
 * Favoriten und Profildaten preisgeben (§42).
 */

// Bei jeder inhaltlichen Änderung des Workers erhöhen — der Name ist der
// Auslöser für das Aufräumen alter Caches.
const VERSION = 'v1';
const STATIC_CACHE = `swissov-static-${VERSION}`;
const PAGE_CACHE = `swissov-pages-${VERSION}`;
const OFFLINE_URL = '/offline';

/** Muss ohne Netz vorhanden sein, damit die App überhaupt startet. */
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

/** Pfade, deren Antworten niemals in einen Cache gehören. */
function isPrivatePath(url) {
  return (
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/login'
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Einzeln statt `addAll`: eine fehlende Datei darf nicht die gesamte
      // Installation scheitern lassen.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* Diese Ressource fehlt — der Worker bleibt trotzdem nutzbar. */
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('swissov-') && name !== STATIC_CACHE && name !== PAGE_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Die Seite bittet um Übernahme der neuen Version.
 * Ohne diese Nachricht bleibt ein neuer Worker wartend — absichtlich.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Fremde Ursprünge (API, Supabase, Kartenkacheln) laufen unverändert durchs
  // Netz. Nichts davon wird zwischengespeichert.
  if (url.origin !== self.location.origin) return;
  if (isPrivatePath(url)) return;

  // 1. Navigation → Netz zuerst, Cache als Sicherheitsnetz.
  //    Eine veraltete Seite wäre schlimmer als eine kurze Wartezeit; ohne
  //    Netz ist eine alte Seite aber besser als der Browser-Dinosaurier.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(PAGE_CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return (
            offline ??
            new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
          );
        }
      })(),
    );
    return;
  }

  // 2. Von Next.js gehashte Build-Dateien → Cache zuerst.
  //    Der Dateiname ändert sich bei jeder Änderung, daher ist der Cache
  //    niemals veraltet.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // 3. Eigene Bilder, Icons, Manifest → Cache zuerst, Netz als Ergänzung.
  if (/\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response('', { status: 504 });
        }
      })(),
    );
  }
});

/**
 * Web Push.
 *
 * Der Server sendet eine kleine JSON-Nutzlast. Kommt etwas Unerwartetes an,
 * wird trotzdem eine Benachrichtigung gezeigt: `userVisibleOnly` verpflichtet
 * uns dazu, und eine stumm verschluckte Push kostet in manchen Browsern das
 * Push-Abo.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'ÖV Live', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'ÖV Live';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    lang: 'de',
    // Gleiche Fahrt = gleicher Tag: eine Folgemeldung ersetzt die vorherige,
    // statt den Sperrbildschirm zu fluten.
    tag: payload.tag || 'oev-live',
    renotify: Boolean(payload.renotify),
    timestamp: Date.now(),
    data: { url: typeof payload.url === 'string' ? payload.url : '/map' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/map';

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Ein bereits offenes Fenster wiederverwenden statt ein zweites zu
      // öffnen — sonst hat man nach drei Meldungen drei Tabs.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await clients.openWindow(target);
    })(),
  );
});

/**
 * Abo abgelaufen (Browser rotiert Endpunkte). Der Client meldet sich beim
 * nächsten Start neu an; hier wird nur aufgeräumt, damit keine tote
 * Registrierung zurückbleibt.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
    })(),
  );
});
