# Produktionsreife — Schweizer ÖV Live (PWA)

**Stand:** 2026-08-16
**Produkt:** Mobile-First Progressive Web App (keine native App, kein App Store)

Diese Datei beantwortet eine einzige Frage: **Was fehlt noch bis zum Livegang?**
Sie unterscheidet dabei drei Zustände und beschönigt nichts.

| Symbol | Bedeutung |
| --- | --- |
| ✅ **BEREIT** | Implementiert, getestet, einsatzfähig |
| 🔑 **BRAUCHT ZUGANGSDATEN** | Vollständig implementiert, wartet nur auf Credentials |
| ⛔ **BLOCKER** | Muss vor dem Livegang erledigt werden |

---

## 1. Auf einen Blick

| Bereich | Status |
| --- | --- |
| Anwendung (Frontend, API, Worker, Datenmodell) | ✅ BEREIT |
| Qualitätssicherung (Lint, Typen, Tests, Build) | ✅ BEREIT |
| Sicherheit (Audit, keine offenen Critical/High) | ✅ BEREIT |
| Fahrplandaten (GTFS Static) | 🔑 BRAUCHT ZUGANGSDATEN |
| Echtzeitdaten (GTFS-RT) | 🔑 BRAUCHT ZUGANGSDATEN |
| Verbindungssuche (OJP) | 🔑 BRAUCHT ZUGANGSDATEN (optional) |
| Anmeldung (Supabase) | 🔑 BRAUCHT ZUGANGSDATEN |
| Push-Benachrichtigungen (VAPID) | 🔑 BRAUCHT ZUGANGSDATEN |
| Betrieb (Hosting, TLS, Backups, Monitoring) | ⛔ BLOCKER |
| Rechtliches (Datenschutzerklärung, Impressum, AGB) | ⛔ BLOCKER |

**Kurzfassung:** Die Software ist fertig. Was fehlt, sind Zugangsdaten, eine
Betriebsumgebung und juristische Texte — alles Dinge, die niemand ausser dem Betreiber
beschaffen kann.

---

## 2. ✅ BEREIT

### Anwendung

| Baustein | Nachweis |
| --- | --- |
| PWA mit 16 Routen, installierbar, offlinefähig | `pnpm --filter @swissov/web build` |
| Service Worker mit versionierten Caches und kontrolliertem Update | `e2e/app.spec.ts` §9 |
| Web-App-Manifest inkl. maskierbarem Icon und Shortcuts | `e2e/app.spec.ts` §9 |
| Installations-UX für Android (Prompt) und iOS (Anleitung) | `src/pwa/pwa.test.ts` |
| Offline-Warteschlange in IndexedDB mit 30-Minuten-Relevanzprüfung | `src/state/offline-queue.test.ts` (13 Tests) |
| Browser-Geolocation ohne vorgetäuschte Hintergrundortung | `src/location/useLocation.test.ts` |
| Fahrtenerkennung, gehärtet gegen Falsch-Positive | `packages/shared/.../scenarios.test.ts` (135 Szenarien) |
| Quellenkennzeichnung OFFIZIELL / COMMUNITY / LIVE / FAHRPLAN / GESCHÄTZT | `src/components/source-badge.test.ts` + E2E §3, §6 |
| Web Push statt Expo Push, inkl. Fehlerbehandlung 404/410/413/429/5xx | `apps/worker/src/jobs/push.job.test.ts` |
| REST-API mit 46 Pfaden, OpenAPI-Spezifikation | `pnpm --filter @swissov/api run openapi` |
| Datenmodell mit PostGIS, RLS auf allen Tabellen, 10 Migrationen | `pnpm db:migrate` |
| Vier Sprachen (de vollständig, fr/it/en mit Rückfall auf de) | `src/i18n/i18n.test.ts` |
| Dunkelmodus, WCAG-AA-Kontraste in beiden Themes | `source-badge.test.ts` |
| DSGVO/CH-DSG: Datenexport und Kontolöschung in der Oberfläche erreichbar | `api.integration.test.ts` |

### Qualitätssicherung

| Prüfung | Ergebnis |
| --- | --- |
| `pnpm lint` | ✅ 11/11 Pakete |
| `pnpm typecheck` | ✅ 17/17 Pakete |
| `pnpm test` | ✅ 482 Tests |
| `pnpm build` | ✅ 10/10 Pakete |
| `pnpm --filter @swissov/api run test:integration` | ✅ 53 Tests gegen echte PostGIS-Datenbank |
| `pnpm --filter @swissov/web run test:e2e` | ✅ 29 Szenarien × Browser (Chromium verifiziert) |
| `node scripts/check-secrets.mjs` | ✅ 212 Dateien, keine Zugangsdaten |

---

## 3. 🔑 BRAUCHT ZUGANGSDATEN

Jede Integration ist vollständig implementiert. Fehlt ein Zugang, degradiert die App
ehrlich statt zu scheitern — die Oberfläche sagt dann, was gerade nicht verfügbar ist.

### 3.1 opentransportdata.swiss — Fahrplan und Echtzeitdaten

**Ohne diesen Zugang gibt es keine Fahrplandaten. Das ist der wichtigste Punkt der Liste.**

```bash
# 1. Kostenlos registrieren:      https://opentransportdata.swiss
# 2. API-Schlüssel in .env eintragen:
OPENTRANSPORTDATA_API_KEY=…

# 3. Erreichbarkeit prüfen (schreibt nichts, dauert Sekunden):
pnpm gtfs:verify-production

# 4. Fahrplan importieren (10–40 Minuten, ~8 GB in der Datenbank):
pnpm db:migrate
pnpm gtfs:import
```

**Wichtiger Hinweis zur bisherigen Prüfung:** Die Entwicklungsumgebung dieses Projekts
erreicht `opentransportdata.swiss` nicht — der ausgehende Proxy beantwortet Anfragen mit
HTTP 403. Sicherheits- oder Netzwerkrichtlinien zu umgehen kam nicht in Frage. Der
Importer wurde stattdessen Ende-zu-Ende gegen einen lokal erzeugten, formatkorrekten
GTFS-Datensatz verifiziert. **Der Import des echten Schweizer Datensatzes ist damit noch
nicht bewiesen** und muss vor dem Livegang einmal durchgeführt werden — dafür existiert
`pnpm gtfs:verify-production`.

### 3.2 Supabase — Anmeldung und Realtime

```bash
SUPABASE_URL=https://<projekt>.supabase.co
SUPABASE_ANON_KEY=…              # öffentlich, darf in den Browser
SUPABASE_SERVICE_ROLE_KEY=…      # NIEMALS in den Browser
SUPABASE_JWT_SECRET=…            # oder JWKS über SUPABASE_URL

NEXT_PUBLIC_SUPABASE_URL=https://<projekt>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
```

Zusätzlich im Supabase-Dashboard:
- **Redirect-URL** auf `https://<domain>/auth/callback` setzen — ohne sie schlägt jeder
  Magic Link fehl.
- E-Mail-Vorlage auf Deutsch anpassen.
- Optional: Apple-/Google-OAuth einrichten.

**Ohne Supabase:** Die App läuft im Gastmodus — lesen ja, melden nein. Der
Anmeldebildschirm sagt das offen.

### 3.3 Web Push — VAPID-Schlüsselpaar

```bash
pnpm push:keys      # erzeugt das Paar, gibt es auf der Konsole aus

WEB_PUSH_VAPID_PUBLIC_KEY=…      # wird an den Browser ausgeliefert (vorgesehen)
WEB_PUSH_VAPID_PRIVATE_KEY=…     # ausschliesslich Serverumgebung des Workers
WEB_PUSH_SUBJECT=mailto:push@<domain>
```

**Warnung:** Ein Wechsel des Schlüsselpaars macht ALLE bestehenden Abos ungültig.
Einmal erzeugen, sicher ablegen, nicht anfassen.

**Ohne VAPID:** Der Schalter „Benachrichtigungen aktivieren" erscheint gar nicht erst;
stattdessen steht „Benachrichtigungen sind auf diesem Server nicht eingerichtet".

### 3.4 OJP — Verbindungssuche (optional)

```bash
OJP_API_KEY=…
OJP_ENDPOINT_URL=https://api.opentransportdata.swiss/ojp20
```

**Ohne OJP:** Die Verbindungssuche arbeitet direkt auf den importierten Fahrplandaten.
Sie findet Direktverbindungen und einfache Umstiege, aber keine optimierten Reiseketten.
`GET /v1/app-config` meldet `journeyPlanner: "gtfs-direct"`, und die Oberfläche weist auf
die Einschränkung hin.

### 3.5 Kartenkacheln

```bash
NEXT_PUBLIC_MAP_TILE_URL=https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json
```

Der voreingestellte swisstopo-Style ist frei nutzbar. Die Nutzungsbedingungen sind vor
dem Livegang zu prüfen; alternativ MapTiler o. Ä. mit eigenem Schlüssel.

**Ohne Style-URL:** Statt einer leeren Fläche erscheint ein Hinweis; alle Listen und
Meldungen funktionieren weiter.

---

## 4. ⛔ BLOCKER

Diese Punkte kann nur der Betreiber erledigen. Ohne sie **darf die App nicht öffentlich
gehen**.

### 4.1 Betriebsumgebung

| Aufgabe | Warum blockierend |
| --- | --- |
| PostgreSQL 16 mit PostGIS 3.4, ≥ 20 GB Speicher | Ohne Datenbank keine Anwendung. |
| HTTPS mit gültigem Zertifikat | Service Worker, Geolocation und Push funktionieren ausschliesslich über HTTPS (Ausnahme: `localhost`). |
| `API_CORS_ORIGINS` auf die echte Web-Domain setzen | Der Browser ist jetzt ein CORS-Client. Bleibt die Liste leer, blockiert er jede API-Anfrage. Das war bei der nativen App nicht so. |
| `API_INTERNAL_SECRET` durch einen echten Zufallswert ersetzen | Wird zum Hashen von IP-Adressen verwendet. Der Platzhalter wird in Produktion vom Env-Schema abgelehnt. |
| Automatisierte Datenbank-Backups mit erprobter Wiederherstellung | Ein ungetestetes Backup ist kein Backup. |
| Rate Limiting auf Reverse-Proxy-Ebene | Siehe SECURITY_AUDIT WEB-011. |
| Health-Checks auf `/health` und `/ready` | Beide sind vom Rate Limit ausgenommen und dafür vorgesehen. |
| Worker als eigener, dauerhaft laufender Prozess | Ohne ihn: keine Echtzeitdaten, kein Push, kein Aufräumen abgelaufener Meldungen. |

### 4.2 Rechtliches

| Aufgabe | Hinweis |
| --- | --- |
| Datenschutzerklärung | Entwurf und offene Fragen in `docs/privacy-architecture.md`, markiert mit `[JURISTISCH PRÜFEN]`. |
| Impressum | Pflichtangabe. |
| Nutzungsbedingungen / Community-Regeln | Grundlage für Moderation und Sperren. |
| Lizenzprüfung der Fahrplandaten | opentransportdata.swiss verlangt eine Quellenangabe. Die Landing-Page enthält sie bereits — Wortlaut prüfen. |
| Abgrenzung zu den Verkehrsbetrieben | Die Landing-Page stellt klar, dass dies kein Angebot der SBB ist. Vor dem Start juristisch bestätigen lassen. |
| Kontrollmeldungen: Zulässigkeit | Die Kategorie „Kontrolle" ist datenschutz- und beförderungsrechtlich nicht trivial. **Vor dem Start klären.** |

### 4.3 Vor dem Start durchzuführen

| Aufgabe | Befehl / Verweis |
| --- | --- |
| Echten Fahrplan importieren und stichprobenartig prüfen | `LIVE_SWITZERLAND_TEST.md` |
| PWA auf einem echten iPhone installieren und testen | `docs/iphone-pwa-test.md` |
| Push-Zustellung auf Android und iOS einmal echt prüfen | `docs/iphone-pwa-test.md`, Abschnitt 6 |
| Lasttest der Erkennungsabfrage mit echten Daten | `EXPLAIN ANALYZE` auf `transit.find_trip_candidates()` |
| Moderations-Team benennen und einweisen | `docs/moderation.md` |

---

## 5. Bewusst NICHT im Umfang

Diese Punkte sind mit der Produktstrategie entfallen und stehen deshalb nicht auf der
Liste:

- **EAS-Build, TestFlight, App Store, Play Store** — es wird keine native App
  veröffentlicht.
- **APNs-Zertifikate, FCM-Server-Key, native Signierung** — Web Push braucht nichts davon,
  nur ein VAPID-Schlüsselpaar.
- **App-Store-Screenshots, Store-Texte, Altersfreigaben, Review-Prozess** — entfällt.
- **Hintergrundortung** — im Browser technisch nicht möglich; wird nicht simuliert.

`apps/mobile` bleibt vorerst im Repository (Referenz und Rückfallebene) und wird nicht
gebaut oder ausgeliefert. Entfernt wird es erst, wenn alle Zeilen in
`MOBILE_TO_WEB_MIGRATION.md` abgehakt sind.

---

## 6. Startreihenfolge

```bash
# 1. Zugangsdaten eintragen
cp .env.example .env && $EDITOR .env

# 2. Externe Quellen prüfen — bricht ab, wenn etwas fehlt
pnpm gtfs:verify-production

# 3. Datenbank vorbereiten
pnpm db:migrate && pnpm db:seed

# 4. Fahrplan importieren (dauert)
pnpm gtfs:import

# 5. Qualitätsprüfung
pnpm lint && pnpm typecheck && pnpm test && pnpm build

# 6. Dienste starten
pnpm --filter @swissov/api start      # Port 3001
pnpm --filter @swissov/worker start   # kein Port
pnpm --filter @swissov/web start      # Port 3002
pnpm --filter @swissov/admin start    # Port 3000

# 7. Erst danach: Live-Prüfung in der Schweiz
#    → LIVE_SWITZERLAND_TEST.md
```
