# Schweizer ÖV Live — Community App

Eine **Progressive Web App** für den öffentlichen Verkehr in der ganzen Schweiz: offizielle
Fahrplan- und Echtzeitdaten, eine Live-Karte, automatische Erkennung der Fahrt,
in der man gerade sitzt, und Community-Meldungen von Fahrgast zu Fahrgast.

Unterstützt werden alle Verkehrsmittel, die im Schweizer Open-Data-Datensatz
enthalten sind: Zug, S-Bahn, Tram, Bus, Trolleybus, PostAuto, Regionalbahn,
Schiff, Standseilbahn und Luftseilbahn.

**Offizielle Meldungen und Community-Meldungen werden konsequent getrennt** —
in der Datenbank, in der API und in der Oberfläche.

Die App läuft im Browser und lässt sich auf iPhone und Android zum
Home-Bildschirm hinzufügen. Eine native App wird derzeit **nicht**
veröffentlicht — der Weg dorthin ist in
[MOBILE_TO_WEB_MIGRATION.md](MOBILE_TO_WEB_MIGRATION.md) beschrieben.
`apps/mobile` liegt noch im Repository, wird aber nicht mehr ausgeliefert.

---

## Inhalt

- [Voraussetzungen](#1-voraussetzungen)
- [Repository klonen](#2-repository-klonen)
- [Dependencies installieren](#3-dependencies-installieren)
- [.env erstellen](#4-env-erstellen)
- [Datenbank starten](#5-datenbank-starten)
- [Migrationen](#6-migrationen)
- [GTFS importieren](#7-gtfs-importieren)
- [Backend starten](#8-backend-starten)
- [Web-App starten](#9-web-app-starten)
- [Admin starten](#10-admin-starten)
- [Tests ausführen](#11-tests-ausführen)
- [Production Build](#12-production-build)
- [Projektstruktur](#projektstruktur)
- [Dokumentation](#dokumentation)

---

## 1. Voraussetzungen

| Werkzeug | Version | Prüfen mit |
|----------|---------|------------|
| Node.js | ≥ 20.11 | `node --version` |
| pnpm | ≥ 9 | `pnpm --version` |
| Docker + Compose | aktuell | `docker compose version` |
| Git | aktuell | `git --version` |

pnpm installieren, falls nicht vorhanden:

```bash
corepack enable && corepack prepare pnpm@10 --activate
```

Für die Mobile-App zusätzlich (erst ab Schritt 9 nötig):

- **iOS**: macOS mit Xcode 15+
- **Android**: Android Studio mit SDK 34+ und einem Emulator

> Die App verwendet native Module (Karte, Standort, Push) und läuft deshalb
> **nicht in Expo Go**, sondern braucht einen Development Build.

---

## 2. Repository klonen

```bash
git clone <repository-url> swissov-live
cd swissov-live
```

---

## 3. Dependencies installieren

```bash
pnpm install
```

Das installiert alle Apps und Pakete des Monorepos in einem Durchgang.

---

## 4. `.env` erstellen

```bash
cp .env.example .env
```

**Für den lokalen Start genügen die Vorgabewerte** — die Datei ist bereits auf
die Docker-Compose-Dienste eingestellt.

Optionale Zugangsdaten (die App läuft auch ohne, mit klar benannten
Einschränkungen):

| Variable | Wofür | Woher |
|----------|-------|-------|
| `OPENTRANSPORTDATA_API_KEY` | Verspätungen, Ausfälle, offizielle Störungen | Kostenlos: <https://opentransportdata.swiss/de/register/> → „Meine Konten" → Token erzeugen |
| `OJP_API_KEY` | Verbindungssuche mit Umstiegen | Gleiche Plattform, separater Token |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Anmeldung, Realtime, Admin-Portal | <https://supabase.com> → Projekt → Settings → API |
| `APPLE_CLIENT_ID`, `GOOGLE_CLIENT_ID` | Anmeldung mit Apple/Google | Apple Developer Program bzw. Google Cloud Console |

**Ohne diese Keys funktioniert:** Fahrplan, Haltestellensuche, Abfahrten,
Fahrtenerkennung, Karte, Direktverbindungen, Gastmodus.
**Ohne diese Keys fehlt:** Echtzeitverspätungen, offizielle Störungen,
Anmeldung (und damit das Erstellen von Meldungen), Umsteigeverbindungen.

Ein vollständiger Überblick steht in `IMPLEMENTATION_STATUS.md`.

> Niemals echte Secrets committen. `.env` ist in `.gitignore`, und ein
> CI-Schritt prüft jeden Commit darauf.

---

## 5. Datenbank starten

```bash
docker compose up -d
```

Startet PostgreSQL 16 mit PostGIS 3.4 (Port 5432) und Redis (Port 6379). Die
Datenbanken `swissov_dev` und `swissov_test` werden automatisch angelegt.

Bereitschaft prüfen:

```bash
docker compose ps
```

<details>
<summary>Ohne Docker (bestehende PostgreSQL-Installation)</summary>

PostgreSQL 15+ **mit PostGIS 3.3+** wird benötigt.

```bash
createdb swissov_dev
createdb swissov_test
psql -d swissov_dev -c "CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent; CREATE EXTENSION pgcrypto;"
psql -d swissov_test -c "CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent; CREATE EXTENSION pgcrypto;"
```

Danach `DATABASE_URL` und `TEST_DATABASE_URL` in `.env` anpassen.
</details>

---

## 6. Migrationen

```bash
pnpm db:migrate     # Schema anlegen
pnpm db:seed        # Kategorien, Feature-Flags, Konfiguration
```

Status prüfen:

```bash
pnpm db:migrate:status
```

Neu aufsetzen (verwirft alle Daten):

```bash
pnpm db:reset
```

---

## 7. GTFS importieren

```bash
pnpm gtfs:import
```

Lädt den aktuellen Schweizer Gesamtfahrplan von opentransportdata.swiss und
importiert ihn. **Kein API-Key nötig.**

> Der Datensatz umfasst rund 30'000 Haltestellen, 900'000 Fahrten und
> 15 Millionen Halte. Der Import dauert **10–25 Minuten** und belegt 6–10 GB.

Für einen schnellen ersten Eindruck:

```bash
pnpm gtfs:import --rows 200000
```

Das liest nur die ersten 200'000 Zeilen je Datei — brauchbar zum Ausprobieren,
aber nicht vollständig.

---

## 8. Backend starten

```bash
pnpm dev
```

Startet API, Worker und Admin-Portal gemeinsam. Einzeln:

```bash
pnpm api:dev       # http://localhost:3001
pnpm worker:dev    # http://localhost:3002
pnpm admin:dev     # http://localhost:3000
```

Prüfen:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/ready
```

Die API-Dokumentation (Swagger UI) liegt unter
<http://localhost:3001/docs>, die Spezifikation unter
<http://localhost:3001/openapi.json>.

Erste echte Abfrage — Haltestellen um Zürich HB:

```bash
curl "http://localhost:3001/v1/stops/nearby?lat=47.3779&lon=8.5403&radius=500"
```

---

## 9. Web-App starten

```bash
pnpm web:dev      # http://localhost:3002
```

Die Landing-Page liegt auf `/`, die App selbst unter `/map`, `/trips`,
`/report`, `/reports`, `/profile` und `/settings`.

Zum Testen auf einem echten Telefon muss `NEXT_PUBLIC_API_URL` in `.env` auf
die IP des Entwicklungsrechners zeigen, zum Beispiel
`http://192.168.1.42:3001`.

> **Service Worker, Standort und Push brauchen HTTPS.** Ausnahme ist
> `localhost`. Auf einem echten Gerät im lokalen Netz funktioniert also
> zunächst nur die Grundfunktion — für die vollständige PWA-Prüfung ist ein
> HTTPS-Tunnel oder eine echte Domain nötig. Siehe
> [docs/iphone-pwa-test.md](docs/iphone-pwa-test.md).

Push-Benachrichtigungen brauchen ein VAPID-Schlüsselpaar:

```bash
pnpm push:keys      # erzeugt es und zeigt, was in .env gehört
```

---

## 10. Admin starten

```bash
pnpm admin:dev      # http://localhost:3000
```

Das Portal benötigt Supabase-Auth. Vorgehen:

1. `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env` setzen
2. In Supabase ein Konto anlegen und **TOTP als zweiten Faktor einrichten**
3. Die Rolle setzen:

```sql
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '<auth-user-id>';
```

Ohne zweiten Faktor verweigert das Portal den Zugriff — das ist beabsichtigt.

---

## 11. Tests ausführen

```bash
pnpm test:unit           # 213 Tests, keine externen Dienste nötig
pnpm test:integration    # 54 Tests gegen PostgreSQL/PostGIS
pnpm test                # beides
```

Die Integrationstests nutzen `TEST_DATABASE_URL` und legen dort einen kleinen,
klar markierten Fixture-Fahrplan an. Die Entwicklungsdatenbank bleibt unberührt.

Weitere Prüfungen:

```bash
pnpm lint
pnpm typecheck
node scripts/check-secrets.mjs
```

---

## 12. Production Build

```bash
pnpm build
```

Baut alle Pakete, API, Worker und Admin-Portal.

Starten:

```bash
node apps/api/dist/index.js
node apps/worker/dist/index.js
pnpm --filter @swissov/admin start
```

```bash
pnpm --filter @swissov/web start     # PWA auf Port 3002
```

Vor dem Livegang: [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) und
[SECURITY_AUDIT.md](SECURITY_AUDIT.md) durchgehen. Die externen Datenquellen
lassen sich vorab prüfen:

```bash
pnpm gtfs:verify-production
```

---

## Projektstruktur

```text
apps/
  api/        Fastify-REST-API, OpenAPI, Auth, Trip-Matching, Moderation
  worker/     GTFS-Import, GTFS-RT-Poller, Push, Ablauf, Aufbewahrung
  admin/      Next.js Admin-Portal
  web/        Next.js PWA — das ausgelieferte Produkt
  mobile/     Expo / React Native (eingefroren, wird nicht ausgeliefert)

packages/
  types/      Zod-Schemas als API-Vertrag
  config/     Validierte Umgebungskonfiguration
  shared/     Geo, Trip-Scoring, Trust, Reputation, Missbrauchsschutz
  database/   Migrationen, Runner, Seeds, Query-Layer
  transit/    GTFS, GTFS-RT, Service Alerts, Journey-Provider
  ui/         Design Tokens

infrastructure/  Docker-Compose-Initialisierung
docs/            Architektur, Daten, Sicherheit, Datenschutz, Betrieb
scripts/         Hilfsskripte
```

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/architecture.md](docs/architecture.md) | Systemaufbau und Entwurfsentscheidungen |
| [docs/transit-data.md](docs/transit-data.md) | GTFS, GTFS-RT, Service Alerts, OJP |
| [docs/trip-detection.md](docs/trip-detection.md) | Fahrtenerkennung im Detail |
| [docs/database.md](docs/database.md) | Schema, Indizes, RLS |
| [docs/security.md](docs/security.md) | Sicherheitsmassnahmen |
| [docs/privacy-architecture.md](docs/privacy-architecture.md) | Datenschutz, Aufbewahrung, offene Rechtsfragen |
| [docs/moderation.md](docs/moderation.md) | Moderation, Trust Score, Reputation |
| [docs/deployment.md](docs/deployment.md) | Betrieb, Überwachung, CI/CD |
| [docs/iphone-pwa-test.md](docs/iphone-pwa-test.md) | PWA-Prüfung auf dem iPhone |
| [MOBILE_TO_WEB_MIGRATION.md](MOBILE_TO_WEB_MIGRATION.md) | Migration der nativen App zur PWA |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Sicherheitsaudit mit Findings und Status |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Was bis zum Livegang fehlt |
| [LIVE_SWITZERLAND_TEST.md](LIVE_SWITZERLAND_TEST.md) | Prüfplan für den echten Betrieb |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Technischer Plan und Risiken |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Was fertig ist und was fehlt |

## Datenquelle

Fahrplan- und Echtzeitdaten stammen von
[opentransportdata.swiss](https://opentransportdata.swiss), der offiziellen
Open-Data-Plattform für den Schweizer öffentlichen Verkehr. Die Nutzungs- und
Lizenzbedingungen der Plattform sind zu beachten.
