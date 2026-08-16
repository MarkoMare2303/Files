# IMPLEMENTATION_PLAN.md

> Schweizer ÖV Live Community App — technischer Plan, Architekturentscheide und Risiken.
> Dieses Dokument wurde **vor** der Implementierung erstellt (siehe Master-Prompt §64) und
> während der Umsetzung fortgeschrieben.

## 0. Ausgangslage

Das Repository war zu Beginn leer (`no commits yet`). Es gibt also keinen Bestandscode,
der respektiert oder migriert werden müsste (§65). Das komplette Monorepo wird neu
initialisiert.

## 1. Architekturentscheide (ADR-Kurzform)

| # | Entscheid | Begründung |
|---|-----------|------------|
| 1 | **Fastify** statt NestJS für `apps/api` | Kleinere Runtime-Overhead-Fläche, sehr gute Zod/JSON-Schema-Integration (`fastify-type-provider-zod`), natives OpenAPI via `@fastify/swagger`. Der Service ist überwiegend datenlastig (Geo-Queries, Matching) und braucht keine schwere DI-Schicht. |
| 2 | **pnpm workspaces + Turborepo** | Standard für TS-Monorepos, inkrementelle Task-Graphen, kein Bundler-Zwang. |
| 3 | **Rohes SQL + eigener Migration-Runner** statt Prisma/Drizzle | PostGIS-Typen (`geography`), GIST-Indizes, SQL-Funktionen, RLS-Policies und `COPY`-Bulk-Import lassen sich mit einem ORM nicht sauber ausdrücken. Migrationen sind versionierte, geprüfte `.sql`-Dateien mit Checksummen. |
| 4 | **GTFS-IDs als `text`-Referenzen in Community-Tabellen**, nicht als FK auf die versionierten Fahrplantabellen | Fahrplanfeeds werden zyklisch komplett ersetzt. Ein FK würde beim Feed-Wechsel Community-Daten kaskadierend löschen. Fahrten werden nach GTFS-Konvention über `trip_id + service_date` identifiziert (identisch zum GTFS-RT `TripDescriptor`). |
| 5 | **Supabase für Auth/Realtime/Storage, eigener Fastify-Service für Domänenlogik** | RLS + Realtime out of the box, aber Trip-Matching, Import, Moderation und Rate-Limiting gehören serverseitig in eigenen Code. |
| 6 | **`auth`-Schema-Shim in Migration 0002** | Damit laufen dieselben Migrationen unverändert gegen Supabase (Schema existiert bereits) **und** gegen ein blankes Postgres in CI/lokal. |
| 7 | **Trip Detection als reine Funktionen in `packages/shared`** | Vollständig unit-testbar ohne DB, wiederverwendbar in API (Server-Scoring) und Mobile (lokales Vorfiltern → Datensparsamkeit, §60). |
| 8 | **Offizielle Meldungen und Community-Meldungen in getrennten Tabellen** | Strukturelle statt konventionelle Trennung — Verwechslung ist damit technisch ausgeschlossen (§7). |
| 9 | **Redis optional, mit In-Memory-Fallback** | Lokale Entwicklung soll ohne Redis starten; in Produktion wird `REDIS_URL` gesetzt. Der Cache-Layer ist eine Abstraktion mit zwei Treibern. |
| 10 | **Expo + Dev Client** (nicht Expo Go) | MapLibre React Native ist ein Native-Modul. Dokumentiert in README. |

## 2. Zielstruktur

```text
/apps
  /api        Fastify REST-API (v1), OpenAPI, Auth, Geo-Queries, Trip Detection
  /worker     Scheduler: GTFS-Import, GTFS-RT-Poller, Alerts, Expiry, Push, Reputation
  /admin      Next.js Admin-Portal (App Router, RSC, MFA-Pflicht)
  /mobile     Expo / React Native / Expo Router
/packages
  /types      Zod-Schemas + abgeleitete TS-Typen = API-Vertrag
  /shared     Reine Domänenlogik: Geo, Trip-Scoring, TTL, Trust, Reputation, Abuse
  /database   Migrationen, Migration-Runner, Seeds, Query-Layer (pg)
  /transit    GTFS-Static-Import, GTFS-RT (protobuf), Service Alerts, OJP-Provider
  /config     Env-Parsing (Zod), typisierte Konfiguration pro App
  /ui         Design Tokens (Farben, Typo, Spacing, Radius, Shadows) für Mobile + Admin
/infrastructure  docker-compose, DB-Init
/docs            Architektur-, Security-, Privacy-, Betriebsdokumentation
/scripts         Dev-Helfer (DB-Setup, GTFS-Import-CLI)
```

## 3. Datenmodell (Kurzfassung)

Siehe `/docs/database.md` für die vollständige Beschreibung.

- **Identity**: `profiles`, `devices`, `user_settings`, `push_subscriptions`, `favorites`
- **Fahrplan (versioniert über `gtfs_imports.id`)**: `agencies`, `routes`, `trips`, `stops`,
  `stop_times`, `shapes`, `calendar`, `calendar_dates`, `feed_info`
- **Echtzeit**: `realtime_trip_updates`, `realtime_stop_time_updates`, `service_alerts`,
  `service_alert_entities`
- **Community**: `report_categories`, `reports`, `report_votes`, `report_flags`,
  `trip_sessions`, `trip_follows`, `user_reputation_events`, `abuse_signals`
- **Betrieb/Admin**: `moderation_actions`, `admin_audit_logs`, `feature_flags`, `app_config`,
  `notification_queue`

## 4. Trip Detection Engine

Zweistufig:

1. **Kandidatensuche (PostGIS, SQL-Funktion `transit.find_trip_candidates`)**
   Haltestellen im Radius → Trips, die diese Haltestellen bedienen → Service-Kalender-Filter
   (inkl. Vortag für Fahrten über Mitternacht) → Zeitfenster-Filter → Distanz zum Shape.
2. **Scoring (`packages/shared/trip-detection`)**
   Gewichtete Teilscores: Shape-Distanz 30 %, Zeit 25 %, Richtung 15 %, Geschwindigkeit 10 %,
   Haltestellensequenz 10 %, GTFS-RT-Kompatibilität 10 %. Ergebnis 0..1 plus Breakdown.

Schwellen: `≥ 0.90` automatisch, `0.70–0.89` Bestätigung, `< 0.70` Auswahlliste (§11).
Alle Schwellen und Gewichte sind über `app_config` administrativ änderbar.

## 5. Technische Risiken

| Risiko | Auswirkung | Mitigation |
|--------|-----------|------------|
| Keine flächendeckenden ÖV-Fahrzeugpositionen in der Schweiz | Kein „echtes" Vehicle-Tracking möglich | Eigene Detection Engine; geschätzte Positionen werden **explizit als Schätzung** gekennzeichnet (§13) |
| GTFS-Schweiz ist sehr gross (`stop_times` ~15 Mio. Zeilen) | Import-Dauer, Query-Latenz | `COPY`-Bulk-Import in Staging-Tabellen, Import-Versionierung mit atomarem Umschalten, gezielte Indizes, Kandidaten-Query mit harten Limits |
| GTFS-RT-Feed-Ausfall / Rate Limits | Verspätungen fehlen | Exponential Backoff, Caching mit `stale-while-error`, Health-Metriken, UI-Fallback-Text (§44) |
| `trip_id`-Instabilität über Feed-Versionen | Community-Meldungen verlieren Bezug | `trip_id + service_date`; Feed-Wechsel invalidiert nur laufende Sessions, historische Reports bleiben |
| GPS-Ungenauigkeit im Tunnel / Zug | Fehlerkennung | Confidence-Schwellen, manuelle Auswahl immer erreichbar (§12), Plausibilitätsprüfung serverseitig |
| Missbrauch des Meldesystems | Falsche Meldungen, Spam | Rate Limits (Account/IP/Device), Impossible-Travel-Check, Duplicate Detection, Trust Score, Moderation Queue, Shadow Flagging (§21) |
| Datenschutz (CH DSG / EU DSGVO) | Rechtliches Risiko | Privacy by Design, Retention-Jobs, Export/Löschung, keine Bewegungshistorie ohne Einwilligung; juristische Prüfpunkte in `/docs/privacy-architecture.md` markiert |

## 6. Reihenfolge der Umsetzung

1. Monorepo-Grundgerüst, Toolchain, Env-Konfiguration
2. `packages/types`, `packages/config`, `packages/ui`
3. `packages/database` — Migrationen, Runner, Seeds
4. `packages/shared` — Geo, Scoring, TTL, Trust, Reputation, Abuse (inkl. Unit-Tests)
5. `packages/transit` — GTFS-Import, GTFS-RT, Alerts, OJP
6. `apps/api` — Auth, Endpunkte, OpenAPI, Rate Limiting, Realtime-Broadcast
7. `apps/worker` — Jobs
8. `apps/admin` — Dashboard, Moderation, Konfiguration, Audit
9. `apps/mobile` — Onboarding, Karte, Trip Screen, Melden, Meldungen, Profil
10. Tests (Unit/Integration/E2E), CI, Dokumentation, Status-Report
