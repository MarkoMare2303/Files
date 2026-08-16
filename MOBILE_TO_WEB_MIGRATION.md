# Migration: React-Native-App → Mobile-First PWA

**Status:** verbindlicher Migrationsplan und Abnahmeliste
**Quelle:** `apps/mobile` (35 Dateien, 4 840 Zeilen)
**Ziel:** `apps/web` (Next.js App Router, installierbare PWA)
**Regel:** Kein Feature geht verloren. Jede Zeile dieser Tabelle wird abgehakt,
bevor `apps/mobile` entfernt werden darf.

---

## 1. Grundsatzentscheidungen

| Thema | Entscheidung | Begründung |
| --- | --- | --- |
| Framework | **Next.js 15, App Router** | Vorhandenes Admin-Portal nutzt bereits Next.js; ein Toolchain-Standard im Monorepo. |
| Rendering | Landing-Page statisch, App-Routen `'use client'` | Die App ist standort- und tokenabhängig — SSR brächte nichts ausser Komplexität. |
| Routing | Landing `/`, App-Routen **auf oberster Ebene** (`/map`, `/trips`, …) | Push-Deep-Links müssen `/trip/[tripId]` und `/reports/[reportId]` treffen; ein `/app`-Präfix würde genau diese Pfade brechen. |
| Styling | Tailwind CSS + CSS-Variablen aus `@swissov/ui` | Die Design-Tokens sind bereits plattformneutral (`themeToCssVariables()`); Tailwind konsumiert sie über `var(--…)`. |
| Karte | `maplibre-gl` (Web-SDK) | Gleiche Style-URL, gleiche Datenquelle wie nativ — nur anderes Rendering-Backend. |
| Zustand | Zustand + TanStack Query (unverändert) | Beide sind plattformunabhängig; nur der Persistenz-Adapter wechselt. |
| Push | **Web Push (VAPID)** statt Expo Push | Expo Push existiert im Browser nicht. Siehe Abschnitt 4. |
| Speicher | `localStorage` (Präferenzen) + **IndexedDB** (Offline-Queue) | `localStorage` ist synchron und klein — für eine Warteschlange mit Payloads ungeeignet. |
| Standort | `navigator.geolocation` | Einzige Browser-API. Hintergrundortung existiert nicht → wird **nicht vorgetäuscht**. |
| `apps/mobile` | bleibt bis zur vollständigen Abnahme im Repo | Rückfallebene und Referenz während der Migration. |

---

## 2. Bildschirme

| Feature | Native (`apps/mobile`) | Web (`apps/web`) | Test | Notizen |
| --- | --- | --- | --- | --- |
| Tab-Navigation | `app/(tabs)/_layout.tsx` (Expo Router Tabs) | `app/(app)/layout.tsx` + `<BottomNav>` mit `env(safe-area-inset-bottom)` | E2E: `app.spec.ts` §2 | Fixierte Bottom-Bar; Safe-Area für iPhone-Notch/Home-Indikator. |
| Karte / Start | `app/(tabs)/index.tsx` (MapLibre RN) | `/map` — `maplibre-gl` in `<MapCanvas>` | E2E: `app.spec.ts` §4 | Keine erfundenen Fahrzeugpositionen — Regel bleibt. Marker für Halte + Community-Meldungen. |
| Meine Fahrten | `app/(tabs)/trips.tsx` | `/trips` | E2E: `app.spec.ts` §4 | Aktive Sitzung, Erkennungsvorschläge, manuelle Auswahl. |
| Melden | `app/(tabs)/report.tsx` | `/report` | E2E: `app.spec.ts` §5, §8 | Ein-Griff-Meldung < 5 s. Haptik: `navigator.vibrate()` mit Feature-Erkennung. |
| Meldungsliste | `app/(tabs)/reports.tsx` | `/reports` | E2E: `app.spec.ts` §3 | Offiziell/Community strikt getrennt dargestellt. |
| Meldungsdetail | *(nicht vorhanden)* | **neu:** `/reports/[reportId]` | E2E: `app.spec.ts` §7 | Erforderlich als Push-Deep-Link-Ziel. |
| Profil | `app/(tabs)/profile.tsx` | `/profile` | E2E: `app.spec.ts` §2 (Navigation) | Reputation, eigene Meldungen, Favoriten. |
| Einstellungen | `app/settings.tsx` | `/settings` | Unit: `pwa.test.ts`; E2E §10 (Bundle ohne Secrets) | Zusätzlich: Push-Abo verwalten, Installationsstatus, Cache leeren. |
| Anmeldung | `app/login.tsx` | `/login` + `/auth/callback` | Unit: `client.test.ts`; manuell (braucht Supabase) | Magic Link braucht im Web eine Callback-Route (`detectSessionInUrl`). |
| Onboarding | `app/onboarding.tsx` | `/onboarding` | Unit: `useLocation.test.ts`; manuell | Erklärt Standort **und** Installation; Standortdialog erst nach Erklärung. |
| Suche | `app/search.tsx` | `/search` | E2E: `app.spec.ts` §6 | Debounce 250 ms, gleiche `/v1/search`-Endpunkte. |
| Haltestelle | `app/stop/[stopId].tsx` | `/stop/[stopId]` | E2E: `app.spec.ts` §6 | Abfahrtstafel mit 30-s-Refresh. |
| Fahrt | `app/trip/[tripId].tsx` | `/trip/[tripId]` | E2E: `app.spec.ts` §6, §7 | Push-Deep-Link-Ziel; `?serviceDate=` als Suchparameter. |
| Landing-Page | *(entfällt nativ)* | **neu:** `/` | E2E: `app.spec.ts` §1 | Erklärt Produkt, Quellenkennzeichnung, Installation. Ohne JS lesbar. |
| Offline-Seite | *(entfällt nativ)* | **neu:** `/offline` | E2E: `app.spec.ts` §8 | Service-Worker-Fallback bei Navigations-Fehlschlag. |

---

## 3. Module

| Feature | Native | Web | Test | Notizen |
| --- | --- | --- | --- | --- |
| API-Client | `src/api/client.ts` (`fetch` + `expo-constants`) | `src/api/client.ts` (`fetch` + `NEXT_PUBLIC_*`) | Unit: `client.test.ts` | Logik identisch: Timeout, `ApiError`, Offline-Erkennung, `accept-language`. |
| Endpunkte | `src/api/endpoints.ts` | 1:1 übernommen | typecheck | `registerDevice` → `platform: 'web'` + `registerPushSubscription` (neu). |
| Query-Hooks | `src/api/hooks.ts` | 1:1 übernommen | typecheck + E2E §3, §6 | Cache-Zeiten unverändert; zusätzlich `refetchOnWindowFocus` (im Web sinnvoll, nativ nicht). |
| Supabase-Auth | `src/auth/supabase.ts` (AsyncStorage) | `src/auth/supabase.ts` (`localStorage`, `detectSessionInUrl: true`) | Unit: `client.test.ts`; manuell (braucht Supabase) | Anon-Key bleibt der einzige clientseitige Schlüssel. Kein Service-Role-Key im Browser. |
| Auth-Bootstrap | `src/auth/useAuth.ts` | 1:1 übernommen | E2E | `signInWithIdToken` (Apple/Google nativ) → OAuth-Redirect-Flow. |
| Standort | `src/location/useLocation.ts` (`expo-location`) | `src/location/useLocation.ts` (`navigator.geolocation`) | Unit: `useLocation.test.ts` (11 Tests) | `AppState` → `visibilitychange`. Permissions API nur zum **Lesen** des Status. |
| Fahrterkennung | `src/location/useTripDetection.ts` | 1:1 übernommen | 135 Szenarien in `packages/shared/.../scenarios.test.ts` | Bewertung bleibt serverseitig. |
| Realtime | `src/realtime/useReportsRealtime.ts` | 1:1 übernommen | E2E (degradiert) | Supabase Realtime funktioniert im Browser identisch (WebSocket). |
| Sitzungs-Store | `src/state/session.store.ts` (AsyncStorage) | `localStorage` via `createJSONStorage` | Unit: `session.store.test.ts` | Token weiterhin **nicht** persistiert. `platform` wird zu `'web'`. |
| Offline-Queue | `src/state/offline-queue.store.ts` (AsyncStorage) | **IndexedDB** (`idb`) + gleicher Zustand-Store | Unit: `offline-queue.test.ts` (13 Tests) | TTL 30 min bleibt; Relevanzprüfung vor dem Upload bleibt; zusätzlich Flush bei `online` und bei `visibilitychange` (iOS-Safari feuert `online` unzuverlässig). |
| Theme | `src/theme/ThemeProvider.tsx` | `src/theme/ThemeProvider.tsx` (CSS-Variablen + `<meta name="theme-color">`) | Unit: `source-badge.test.ts`; E2E §11 | `prefers-color-scheme` statt `useColorScheme()`. |
| i18n | `src/i18n/*` | unverändert kopiert | Unit: `i18n.test.ts` | Zusätzlich `<html lang>` und `Accept-Language`-Vorauswahl. |
| Primitives | `src/components/primitives.tsx` (RN `View`/`Text`) | DOM + Tailwind (`Button`, `Card`, `Badge`, `Text`, `Divider`) | E2E §11 (Touch-Grösse, Tastatur, Fokus) | Alle interaktiven Elemente werden echte `<button>`/`<a>` → Tastatur & Screenreader gratis. |
| Zustände | `src/components/states.tsx` | 1:1 portiert | E2E §3, §5 | `LoadingList`, `ErrorState`, `EmptyState`, `DataNotice`. |
| ReportCard | `src/components/ReportCard.tsx` | 1:1 portiert | Unit: `source-badge.test.ts`; E2E §3 | Quellen-Badge bleibt Pflichtbestandteil. |
| Konfiguration | `src/config.ts` (`expo-constants`) | `src/config.ts` (`process.env.NEXT_PUBLIC_*`) | typecheck + E2E §10 | Gleiche Regel: ausschliesslich nicht-geheime Werte. |

---

## 4. Push: Expo → Web Push

| Aspekt | Native (Ist) | Web (Soll) | Test |
| --- | --- | --- | --- |
| Transport | Expo Push Service (`exp.host`) | Web Push Protocol (RFC 8030) direkt an den Browser-Endpunkt | Integration: `push.job.test.ts` |
| Registrierung | `expo_push_token` (String) | `endpoint` + `p256dh` + `auth` (Subscription-Objekt) | Integration: `POST /v1/me/push-subscriptions` |
| Schlüssel | `EXPO_ACCESS_TOKEN` (optional) | `WEB_PUSH_VAPID_PUBLIC_KEY` / `WEB_PUSH_VAPID_PRIVATE_KEY` / `WEB_PUSH_SUBJECT` | Unit |
| Öffentlicher Schlüssel | — | über `GET /v1/app-config` ausgeliefert (**nur der öffentliche**) | Integration |
| Privater Schlüssel | — | **niemals** im Browser; nur im Worker-Prozess | Secret-Scan + Audit |
| Zustellung | Ticket-Antwort mit `DeviceNotRegistered` | HTTP-Status: `404`/`410` → Abo dauerhaft löschen; `429`/`5xx` → Backoff; `413` → Payload kürzen | Integration |
| Anzeige | `expo-notifications` | `self.registration.showNotification()` im Service Worker | Unit: `pwa.test.ts`; Gerätetest in `docs/iphone-pwa-test.md` |
| Deep-Link | Expo-Router-Link | `notificationclick` → `clients.openWindow('/trip/…' \| '/reports/…')` | E2E |
| Datenbank | `push_subscriptions.expo_push_token` | Migration `0010`: neue Spalten + Constraint, Altspalte nullable | Migrationstest |

**Nicht migrierbar (ehrlich dokumentiert):**
Push auf iOS funktioniert **nur**, wenn die PWA über „Zum Home-Bildschirm" installiert
wurde (iOS ≥ 16.4). Im Safari-Tab gibt es keine Push-API. Die App erkennt das und
erklärt es, statt einen toten Schalter anzuzeigen.

---

## 5. Nativ-Funktionen ohne Web-Entsprechung

| Native Funktion | Web-Status | Umgang |
| --- | --- | --- |
| Hintergrund-Standort (`UIBackgroundModes: location`) | **Nicht möglich** | Wird **nicht** simuliert. Onboarding und Einstellungen sagen klar: Erkennung läuft nur bei geöffneter App. Kein toter Schalter. |
| `expo-secure-store` | Kein Browser-Äquivalent | Token bleibt ausschliesslich im Speicher; Refresh-Token liegt im Supabase-Client (`localStorage`) — dokumentiert im Sicherheitsaudit. |
| `expo-haptics` | Teilweise (`navigator.vibrate`, nicht in iOS Safari) | Feature-Erkennung; ohne Vibration bleibt die visuelle Rückmeldung. |
| Apple-/Google-Sign-in per nativem SDK | OAuth-Redirect | Über Supabase-OAuth statt Identity-Token. |
| App-Store-Auslieferung | Entfällt | EAS/TestFlight/APNs aus der Produktionsreife-Planung entfernt. |
| Push ohne Installation (iOS) | Nicht möglich | Siehe Abschnitt 4. |

---

## 6. Neu, weil PWA

| Feature | Datei | Test |
| --- | --- | --- |
| Web-App-Manifest | `public/manifest.webmanifest` | E2E: `app.spec.ts` §9 |
| Service Worker (versioniert) | `public/sw.js` | E2E: `app.spec.ts` §8, §9 |
| Offline-Fallback | `app/offline/page.tsx` | E2E: `app.spec.ts` §8 |
| Update-Hinweis („Eine neue Version ist verfügbar.") | `src/pwa/useServiceWorker.ts` | E2E: `app.spec.ts` §9 |
| Installations-UX (Android/Chrome) | `src/pwa/useInstallPrompt.ts` (`beforeinstallprompt`) | E2E |
| Installations-Anleitung (iOS) | `src/components/InstallHint.tsx` | E2E |
| Icons (192/512/maskable/Apple-Touch) | `public/icons/*` | E2E: `app.spec.ts` §9 |
| Web-Push-Abo-Verwaltung | `src/push/usePushSubscription.ts` | E2E |
| Safe-Area-Layout | `app/globals.css` | E2E (iPhone-Viewport) |

---

## 7. Backend-Änderungen

| Änderung | Ort | Grund |
| --- | --- | --- |
| `platform`-Enum um `'web'` erweitert | Migration `0010` | Geräteregistrierung aus dem Browser. |
| Tabelle `push_subscriptions` auf Web-Push umgestellt | Migration `0010` | Endpunkt statt Expo-Token. |
| `POST/DELETE /v1/me/push-subscriptions` | `apps/api/src/routes/me.ts` | Abo anlegen/entfernen. |
| `webPush.publicKey` in `/v1/app-config` | `apps/api/src/routes/app-config.ts` | Client braucht den **öffentlichen** VAPID-Schlüssel. |
| Push-Job auf Web Push umgestellt | `apps/worker/src/jobs/push.job.ts` | Neuer Transport inkl. Fehlerbehandlung. |
| CORS-Origins für die Web-App | `.env` `API_CORS_ORIGINS` | Der Browser ist jetzt ein CORS-Client — nativ war er es nicht. |

---

## 8. Abnahmekriterien

- [x] Jede Zeile in Abschnitt 2 und 3 ist portiert und durch mindestens einen Test
      abgedeckt (Unit, Integration oder E2E).
- [x] `pnpm lint` (11/11), `pnpm typecheck` (17/17), `pnpm test` (482), `pnpm build` (10/10).
- [x] Playwright: **29 Szenarien** in elf Gruppen. Auf Chromium (Desktop und Pixel-Viewport)
      hier ausgeführt und grün. **WebKit und Firefox konnten in dieser Umgebung nicht
      ausgeführt werden** — es ist nur ein Chromium-Build vorinstalliert. Die Projekte sind
      konfiguriert, der CI-Job installiert alle drei Engines:
      `pnpm --filter @swissov/web run test:e2e:install`.
- [x] Manifest, Icons und Service Worker durch E2E-Tests geprüft; Offline-Start funktioniert.
      **Kein Lighthouse-Lauf** — dafür fehlt in dieser Umgebung der passende Browser.
- [x] `SECURITY_AUDIT.md`: keine offenen Critical/High-Findings.
- [x] `PRODUCTION_READINESS.md` erstellt und gepflegt.
- [ ] **`apps/mobile` bleibt vorerst liegen.** Entfernen erst, wenn die PWA einmal auf
      echten Geräten in der Schweiz geprüft wurde — `LIVE_SWITZERLAND_TEST.md` und
      `docs/iphone-pwa-test.md`.

### Was in dieser Umgebung NICHT geprüft werden konnte

Ehrlich benannt, statt als erledigt ausgegeben:

| Punkt | Grund | Wie es nachgeholt wird |
| --- | --- | --- |
| E2E auf WebKit (iOS-Safari) und Firefox | Nur Chromium vorinstalliert | CI-Job `e2e` installiert alle drei Engines |
| Echte Push-Zustellung | Braucht VAPID-Paar, HTTPS-Domain und ein Gerät | `docs/iphone-pwa-test.md` Abschnitt 6 |
| Installation auf einem echten iPhone | Kein Gerät verfügbar | `docs/iphone-pwa-test.md` |
| Import des echten Schweizer Fahrplans | `opentransportdata.swiss` antwortet hier mit HTTP 403; Netzwerkrichtlinien wurden nicht umgangen | `pnpm gtfs:verify-production`, dann `pnpm gtfs:import` |
| Lighthouse-Bericht | Kein passender Browser | Nach dem ersten Deployment gegen die echte Domain |
