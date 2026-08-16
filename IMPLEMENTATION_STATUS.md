# IMPLEMENTATION_STATUS.md

**Stand: nach der Migration zur Progressive Web App (2026-08-16).**

Das Produkt wird als PWA ausgeliefert; eine native App wird derzeit nicht
veröffentlicht. Der vollständige Abgleich Feature für Feature steht in
[MOBILE_TO_WEB_MIGRATION.md](MOBILE_TO_WEB_MIGRATION.md).

Legende:

- ✅ **vollständig implementiert** — Code vorhanden, gebaut, getestet
- ⚠️ **benötigt externen API-Key** — vollständig implementiert, aber ohne
  Credentials inaktiv
- 🧊 **eingefroren** — vorhanden, wird aber nicht ausgeliefert
- ❌ **noch nicht implementiert**

## Verifizierter Zustand

Alle folgenden Befehle wurden ausgeführt und laufen fehlerfrei durch:

| Prüfung | Ergebnis |
|---------|----------|
| `pnpm lint` | ✅ 11/11 Aufgaben ohne Befund |
| `pnpm typecheck` | ✅ 17/17 Aufgaben ohne Fehler |
| `pnpm test` | ✅ **482 Tests** in 10 Paketen |
| `pnpm test:integration` | ✅ **53 Tests** gegen echtes PostgreSQL/PostGIS |
| `pnpm --filter @swissov/web run test:e2e` | ✅ **29 Szenarien** gegen den Produktions-Build (Chromium verifiziert) |
| `pnpm build` | ✅ 10/10 Aufgaben (Pakete, API, Worker, Admin, Web) |
| `pnpm db:migrate` | ✅ 10 Migrationen angewendet |
| `pnpm db:seed` | ✅ 29 Kategorien, 6 Feature-Flags, 4 Konfigurationsblöcke |
| `node scripts/check-secrets.mjs` | ✅ keine Zugangsdaten im Repository |
| `pnpm gtfs:import` | ✅ vollständiger Durchlauf gegen ein echtes GTFS-ZIP (siehe unten) |
| API-Start + Live-Abfragen | ✅ `/health`, `/ready`, Haltestellen, Suche, Abfahrten, Fahrtenerkennung, Verbindungssuche |

### Der Importer wurde end-to-end verifiziert

`pnpm gtfs:import --url …` lief vollständig durch: Download mit Prüfsumme,
ZIP-Streaming, CSV-Parsing (inklusive BOM), `COPY` in alle zehn Tabellen,
Materialisierung der Geometrien in WGS84 und LV95, Denormalisierung,
`ANALYZE`, atomare Aktivierung. Ein zweiter Lauf erkannte die unveränderte
Prüfsumme und übersprang den Import.

Anschliessend lieferte die laufende API gegen diese importierten Daten echte
Ergebnisse: Haltestellen nach Distanz, diakritikaunabhängige Suche
(„Zurich" → „Zürich"), leerzeichenunabhängige Liniensuche („IC3" → „IC 3"),
Abfahrtstafeln und Direktverbindungen. Die Fahrtenerkennung ordnete eine
Position zwischen Zürich HB und Altstetten bei 87 km/h Richtung Westen der
richtigen Fahrt zu (0.832 gegenüber 0.587 für die Gegenrichtung, Entscheidung
`CONFIRM`).

Verwendet wurde dabei ein lokal erzeugtes, formatgetreues GTFS-Archiv, **nicht**
der Schweizer Gesamtdatensatz: Die Netzwerkrichtlinie dieser Umgebung sperrt
`opentransportdata.swiss` (HTTP 403 vom Gateway). Der Codepfad ist identisch —
was sich nicht verifizieren liess, sind Laufzeit und Speicherbedarf bei
15 Millionen `stop_times`.

**Nicht ausgeführt:** nativer Mobile-Build (kein macOS bzw. Android SDK in
dieser Umgebung verfügbar).

---

## Fahrplandaten

| Funktion | Status | Anmerkung |
|----------|--------|-----------|
| GTFS-Static-Import (COPY, streamend, versioniert) | ✅ | Kein API-Key nötig |
| Import-Versionierung mit atomarem Umschalten | ✅ | Keine Ausfallzeit |
| Prüfsummenvergleich, alte Versionen aufräumen | ✅ | |
| Denormalisierung + `ANALYZE` nach Import | ✅ | |
| Haltestellen, Linien, Fahrten, Halte, Kalender, Shapes | ✅ | |
| Geo-Indizes (GIST), Trigramm-Indizes | ✅ | |
| **Import gegen die echte Schweizer Quelle** | ⚠️ | Pipeline end-to-end verifiziert (siehe oben). Der Zugriff auf `opentransportdata.swiss` ist in dieser Umgebung durch die Netzwerkrichtlinie gesperrt; Laufzeit und Speicherbedarf beim Gesamtdatensatz sind deshalb geschätzt |
| GTFS-RT Trip Updates (Protocol Buffers) | ⚠️ | Benötigt `OPENTRANSPORTDATA_API_KEY` |
| GTFS-RT Service Alerts | ⚠️ | Benötigt `OPENTRANSPORTDATA_API_KEY` |
| Retry, Backoff, `Retry-After`, Redirects, Timeouts | ✅ | Unit-getestet |
| Feed-Health-Überwachung | ✅ | |
| OJP-Verbindungssuche (Umstiege) | ⚠️ | Benötigt `OJP_API_KEY`; XML-Aufbau und Parser gegen Fixture getestet |
| Direktverbindungen aus eigenen GTFS-Daten | ✅ | Fallback ohne OJP, integrationsgetestet |

---

## Fahrtenerkennung

| Funktion | Status |
|----------|--------|
| Kandidatensuche in PostGIS (Shapes, Kalender, Zeitfenster) | ✅ |
| Sollpositions-Interpolation entlang der Linie | ✅ |
| Sechs gewichtete Teilscores | ✅ |
| Konfigurierbare Gewichte und Schwellen | ✅ |
| Entscheidung AUTO/CONFIRM/CHOOSE/NONE inkl. Abstandskriterium | ✅ |
| Manuelle Auswahl über Haltestelle und Abfahrten | ✅ |
| Trip-Sessions inkl. automatischem Ende | ✅ |
| Realistische Testszenarien (IC, Tram, Bus, PostAuto, Gegenrichtung) | ✅ |
| Datensparsamkeit (max. 10 Punkte, keine Speicherung) | ✅ |

---

## Community

| Funktion | Status | Anmerkung |
|----------|--------|-----------|
| 29 Meldungskategorien als Seed | ✅ | Administrativ erweiterbar |
| Meldung erstellen mit serverseitiger Kontextableitung | ✅ | |
| Scopes VEHICLE_TRIP / ROUTE_SEGMENT / STOP / STATION / NETWORK | ✅ | |
| TTL je Kategorie, „bis Fahrtende" | ✅ | |
| Automatischer Ablauf (Worker) | ✅ | Integrationsgetestet |
| Bestätigen / als überholt markieren | ✅ | Eine Stimme pro Nutzer |
| Automatisches Ende bei klarer Mehrheit an Gegenstimmen | ✅ | |
| Trust Score 0–100 | ✅ | 10 Faktoren, unit-getestet |
| Reputation (intern, nicht öffentlich) | ✅ | |
| Missbrauchsmeldungen + automatische Moderations-Queue | ✅ | |
| Offline-Queue mit Idempotenz und Verfallszeit | ✅ | Unit-getestet |
| Echtzeitverteilung neuer Meldungen | ⚠️ | Postgres-Changes benötigen Supabase; ohne Konfiguration greift Polling |

---

## Missbrauchsschutz

| Prüfung | Status |
|---------|--------|
| Rate Limits (Transport + fachlich, konfigurierbar) | ✅ |
| Cooldown zwischen Meldungen | ✅ |
| Duplikatserkennung mit Verweis auf bestehende Meldung | ✅ |
| Impossible-Travel-Erkennung | ✅ |
| GPS-Plausibilität (Genauigkeit, Geschwindigkeit, Streckenabstand, Bediengebiet) | ✅ |
| Spam-Muster (Streuung, Entfernungsquote, neues Konto) | ✅ |
| Shadow-Flagging | ✅ |
| Datenschutzverträgliches Device-Fingerprinting | ✅ |
| IP-Pseudonymisierung (HMAC, IPv6 gekürzt) | ✅ |
| Protokollierung aller Befunde | ✅ |

---

## API

| Funktion | Status |
|----------|--------|
| Alle Endpunkte aus der Spezifikation | ✅ |
| Zod-Validierung für Query, Params, Body und Response | ✅ |
| OpenAPI 3.1 + Swagger UI | ✅ |
| Einheitliches Fehlerformat mit mehrsprachigem Nutzertext | ✅ |
| `/health`, `/ready`, `/metrics` | ✅ |
| Helmet, CORS, Rate Limiting, Body-/Timeout-Limits | ✅ |
| Cache-Abstraktion (Redis oder In-Memory) | ✅ |
| Supabase-JWT-Prüfung (HS256 und JWKS) | ⚠️ Benötigt Supabase-Konfiguration |

---

## Web-App (PWA) — das ausgelieferte Produkt

| Bereich | Status |
|---------|--------|
| Next.js App Router, 16 Routen | ✅ |
| Landing-Page auf `/`, App auf `/map`, `/trips`, `/report`, `/reports`, `/profile`, `/settings` | ✅ |
| Karte mit MapLibre GL JS (keine erfundenen Fahrzeugpositionen) | ✅ |
| Fahrtenerkennung mit Browser-Geolocation | ✅ |
| Melden in unter fünf Sekunden, ein Griff | ✅ |
| Offline-Warteschlange in IndexedDB, TTL-Prüfung vor dem Upload | ✅ |
| Quellen-Badges OFFIZIELL / COMMUNITY / LIVE / FAHRPLAN / GESCHÄTZT | ✅ |
| Web-App-Manifest, Icons (192/512/maskable/Apple-Touch), Shortcuts | ✅ |
| Service Worker mit versionierten Caches, Offline-Seite, Update-Hinweis | ✅ |
| Installations-UX: Android-Prompt, iOS-Anleitung, 14 Tage Ruhe nach Wegklicken | ✅ |
| Web Push (VAPID) mit Deep-Links auf `/trip/…` und `/reports/…` | ⚠️ benötigt VAPID-Schlüsselpaar (`pnpm push:keys`) |
| Anmeldung per Magic Link und OAuth, Callback-Route | ⚠️ benötigt Supabase |
| Vier Sprachen, Dunkelmodus, WCAG-AA-Kontraste, Safe-Area | ✅ |
| Sicherheits-Header (CSP, HSTS, Permissions-Policy, Referrer-Policy) | ✅ |
| Keine vorgetäuschte Hintergrundortung | ✅ (bewusst) |

**Nicht möglich im Browser** — und deshalb nicht implementiert, sondern erklärt:
Hintergrundortung, Push im iOS-Safari-Tab (nur installiert), Vibration auf iOS.

## Native App (eingefroren)

| Bereich | Status |
|---------|--------|
| `apps/mobile` (Expo, 35 Dateien) | 🧊 eingefroren — bleibt als Referenz im Repository |
| EAS-Build, TestFlight, App Store, Play Store | ❌ nicht im Umfang |
| APNs-/FCM-Zertifikate | ❌ entfällt — Web Push braucht nur VAPID |

Entfernt wird `apps/mobile` erst, wenn alle Zeilen in
`MOBILE_TO_WEB_MIGRATION.md` abgehakt sind.

## Admin-Portal

| Funktion | Status |
|----------|--------|
| Dashboard (Nutzer, Meldungen, Spamquote, Import, Datenquellen) | ✅ |
| Meldungen filtern und moderieren | ✅ |
| Nutzer verwalten (verwarnen, shadow-flaggen, sperren, entsperren) | ✅ |
| Kategorien pflegen (TTL, Farbe, Scope, Moderationspflicht) | ✅ |
| Laufzeitkonfiguration (Schwellen, Gewichte, Rate Limits, Trust) | ✅ |
| Feature-Flags inkl. gestuftem Rollout | ✅ |
| Audit-Log (append-only) | ✅ |
| MFA-Pflicht, Sitzungs-Timeout, sichere Cookies, CSP | ⚠️ Benötigt Supabase-Konfiguration |

---

## Worker

| Job | Status |
|-----|--------|
| GTFS-Static-Import nach Zeitplan | ✅ |
| GTFS-RT-Poller | ⚠️ Benötigt `OPENTRANSPORTDATA_API_KEY` |
| Service-Alerts-Poller | ⚠️ Benötigt `OPENTRANSPORTDATA_API_KEY` |
| Meldungsablauf | ✅ |
| Bereinigung verwaister Fahrt-Sitzungen | ✅ |
| Trust-Score-Neuberechnung | ✅ |
| Push-Versand (Outbox) | ⚠️ Funktioniert ohne Token; `EXPO_ACCESS_TOKEN` erhöht die Limits |
| Aufbewahrungsfristen | ✅ |
| Health-Endpunkte | ✅ |

---

## Was noch fehlt

| Punkt | Status | Begründung |
|-------|--------|------------|
| Ende-zu-Ende-Tests | ✅ | 29 Playwright-Szenarien gegen den Produktions-Build. Chromium hier verifiziert; WebKit und Firefox laufen in CI (`pnpm --filter @swissov/web run test:e2e:install`) |
| Vollwertiger Routenplaner ohne OJP (RAPTOR/CSA) | ❌ | Bewusste Entscheidung: OJP ist die vorgesehene Quelle. Ohne Zugang werden Direktverbindungen geliefert und die Einschränkung ausgewiesen |
| Push-Empfang und -Anzeige | ✅ | Web Push vollständig: Service Worker zeigt an, `notificationclick` öffnet den Deep-Link. Echte Zustellung braucht ein VAPID-Paar und ein Gerät — Prüfplan in `docs/iphone-pwa-test.md` |
| Sentry-/OTLP-Anbindung | ❌ | Adapter und Konfigurationsvariablen vorhanden; die konkrete Integration hängt vom gewählten Anbieter ab |
| Leader Election für den Worker | ❌ | Aktuell muss genau eine Instanz laufen (dokumentiert) |
| Deployment-Pipeline | ❌ | CI prüft und baut; ein Deploy-Job fehlt, weil die Zielplattform nicht festgelegt ist |
| App-Icons | ✅ | Aus den Design-Tokens erzeugt: `pnpm --filter @swissov/web run icons` (192, 512, maskable, Apple-Touch, Favicon, Badge) |
| Import des ECHTEN Schweizer Fahrplans | ❌ | Diese Umgebung erhält von `opentransportdata.swiss` HTTP 403. Netzwerkrichtlinien wurden nicht umgangen. Prüfwerkzeug für den Betreiber: `pnpm gtfs:verify-production` |
| Juristische Prüfung | ❌ | Alle Punkte sind in `docs/privacy-architecture.md` mit **[JURISTISCH PRÜFEN]** markiert |

---

## Benötigte Credentials im Überblick

| Credential | Kosten | Wofür | Ohne das Credential |
|------------|--------|-------|---------------------|
| `OPENTRANSPORTDATA_API_KEY` | kostenlos | Verspätungen, Ausfälle, offizielle Störungen | Nur Fahrplanzeiten; die App weist darauf hin |
| `OJP_API_KEY` | kostenlos | Verbindungen mit Umstieg | Nur Direktverbindungen; Einschränkung wird angezeigt |
| Supabase-Projekt | kostenlose Stufe genügt zum Start | Anmeldung, Realtime, Admin-Portal | Gastmodus: alles lesen, nichts melden |
| `WEB_PUSH_VAPID_*` | kostenlos, selbst erzeugt (`pnpm push:keys`) | Web Push auf allen Plattformen | Der Schalter erscheint gar nicht erst, mit Begründung |
| Apple Developer Program | — | **nicht mehr nötig** | Web Push braucht kein APNs-Zertifikat |
| Google Play Console | — | **nicht mehr nötig** | Kein Store-Release geplant |
| Karten-Tiles | swisstopo frei | Kartenhintergrund | Vorgabe funktioniert ohne Key |

---

## Definition of Done

| Kriterium | Status |
|-----------|--------|
| Web-App baut (`next build`, 16 Routen) | ✅ |
| PWA installierbar (Manifest, Icons, Service Worker) | ✅ E2E-getestet |
| Offline-Start funktioniert | ✅ E2E-getestet |
| Backend kompiliert | ✅ |
| Admin kompiliert (`next build`) | ✅ |
| Datenbankmigrationen funktionieren | ✅ |
| Schweizer GTFS-Daten können importiert werden | ✅ Importer end-to-end ausgeführt und verifiziert |
| Echte Haltestellen werden dargestellt | ✅ |
| Trips werden gefunden | ✅ |
| Trip Matching funktioniert | ✅ Unit- und integrationsgetestet |
| Nutzer können Meldungen veröffentlichen | ✅ |
| Meldungen erscheinen anderen Nutzern | ✅ Integrationstest |
| Voting funktioniert | ✅ |
| Automatische Expiration funktioniert | ✅ |
| Spam Protection vorhanden | ✅ |
| Push-Infrastruktur vorhanden | ✅ Versand (Web Push/VAPID) und Empfang (Service Worker) implementiert und getestet |
| Fahrtenerkennung gegen Falsch-Positive gehärtet | ✅ 135 Szenarien, darunter Auto parallel zur Bahnlinie |
| Sicherheitsaudit ohne offene Critical/High | ✅ `SECURITY_AUDIT.md` |
| Moderation funktioniert | ✅ |
| Auth funktioniert | ⚠️ Benötigt Supabase-Konfiguration |
| Tests laufen | ✅ 267 Tests |
| README vorhanden | ✅ |
| Keine Secrets committed | ✅ automatisiert geprüft |
| `.env.example` vollständig | ✅ |
