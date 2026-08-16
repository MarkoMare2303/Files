# Datenbank

PostgreSQL 15+ mit PostGIS 3.3+. Erweiterungen: `postgis`, `pgcrypto`,
`pg_trgm` (unscharfe Suche), `unaccent` (diakritikaunabhängige Suche).

## Zwei Schemas

| Schema | Inhalt | Lebensdauer |
|--------|--------|-------------|
| `transit` | Importierte ÖV-Daten (GTFS, GTFS-RT, Alerts) | wird zyklisch komplett ersetzt |
| `public` | Nutzer, Community-Meldungen, Moderation, Konfiguration | dauerhaft |

Die Trennung macht die unterschiedliche Lebensdauer sichtbar und verhindert,
dass ein Fahrplanimport versehentlich Nutzerdaten berührt.

## Migrationen

Reine `.sql`-Dateien, aufsteigend nummeriert, mit SHA-256-Prüfsumme
protokolliert. Eine nachträglich veränderte, bereits angewendete Migration
führt zu einem harten Fehler — das verhindert auseinanderlaufende Umgebungen.

```bash
pnpm db:migrate          # anwenden
pnpm db:migrate:status   # Status inkl. Prüfsummenvergleich
pnpm db:seed             # Stammdaten
pnpm db:reset            # verwerfen, migrieren, seeden (nicht in Produktion)
```

| Datei | Inhalt |
|-------|--------|
| `0001_extensions.sql` | Erweiterungen, `transit`-Schema, Suchnormalisierung |
| `0002_auth_shim.sql` | `auth`-Schema-Ersatz für lokale Entwicklung und CI |
| `0003_identity.sql` | `profiles`, `devices`, `user_settings`, `push_subscriptions`, `favorites` |
| `0004_transit_static.sql` | GTFS-Static inkl. Import-Versionierung |
| `0005_transit_realtime.sql` | GTFS-RT, Service Alerts, `feed_health` |
| `0006_community.sql` | Meldungen, Kategorien, Stimmen, Flags, Sessions, Reputation, Abuse |
| `0007_admin.sql` | Moderation, Audit-Log, Feature-Flags, `app_config` |
| `0008_geo_functions.sql` | Geo- und Fahrplanabfragen als SQL-Funktionen |
| `0009_rls.sql` | Row Level Security, Realtime-Publikation |

### Der Auth-Shim

Supabase stellt `auth.users`, `auth.uid()` und `auth.role()` bereit. Migration
`0002` legt einen minimalen Ersatz an — aber nur, wenn er fehlt. Dadurch laufen
dieselben Migrationen unverändert gegen Supabase **und** gegen ein blankes
PostgreSQL in CI und lokaler Entwicklung. Auf Supabase ändert die Migration
nichts.

Die API erkennt beim Start, welche Variante vorliegt (`authMode`), und legt nur
im Shim-Fall selbst `auth.users`-Zeilen an.

## Zentrale Entwurfsentscheidungen

### GTFS-Referenzen ohne Fremdschlüssel

`reports.trip_id`, `route_id`, `stop_id` sind `text` ohne FK auf die
versionierten Fahrplantabellen. Grund: Feeds werden komplett ersetzt; ein
Fremdschlüssel würde beim Wechsel Community-Daten kaskadierend löschen.
Referenzielle Integrität besteht dort, wo sie stabil ist: `user_id`,
`category_id`, `report_id`.

### Zeiten als Integer

`stop_times.arrival_seconds` / `departure_seconds` sind `integer` — Sekunden
seit Betriebstagsbeginn. Werte ≥ 86400 bedeuten Folgetag (Nachtverkehr). Das
ist schmaler und schneller als `interval` oder `text` und entspricht der
GTFS-Semantik. `transit.service_time(date, seconds)` rechnet in absolute
Zeitpunkte um und behandelt Sommerzeitwechsel korrekt.

### Zwei Bezugssysteme

- `geom geography(Point, 4326)` — für Umkreissuchen (`ST_DWithin`) und Ausgabe
- `geom_lv95 geometry(…, 2056)` — CH1903+/LV95, metrisch und planar

Distanz-, Projektions- und Azimutberechnungen laufen auf LV95: exakt in Metern,
deutlich schneller als geodätische Berechnungen und für die Schweiz das
amtliche Bezugssystem.

### Denormalisierung auf `trips`

`start_seconds`, `end_seconds`, `first_stop_id`, `last_stop_id`,
`first_stop_name`, `last_stop_name`, `stop_count` werden beim Import berechnet.
Ohne sie bräuchte jede Kandidatensuche ein Aggregat über `stop_times` — bei
15 Mio. Zeilen nicht vertretbar.

## Wichtige Indizes

| Index | Zweck |
|-------|-------|
| `shapes_geom_lv95_idx` (GIST) | Kandidatensuche — der wichtigste Index des Systems |
| `stops_geom_idx` (GIST) | Haltestellen im Umkreis |
| `stops_name_trgm_idx` (GIN) | Unscharfe Suche |
| `stop_times_departures_idx` | Abfahrtstafeln |
| `trips_window_idx` | Aktive Fahrten im Zeitfenster |
| `reports_trip_idx` (partiell) | Meldungen einer Fahrt |
| `reports_location_idx` (GIST, partiell) | Meldungen auf der Karte |
| `reports_expiry_idx` (partiell) | Ablauf-Job |
| `reports_moderation_idx` (partiell) | Moderations-Queue |

Partielle Indizes auf `status = 'ACTIVE'` halten die für Abfragen relevanten
Indizes klein, auch wenn die Tabelle historische Meldungen enthält.

## SQL-Funktionen

| Funktion | Zweck |
|----------|-------|
| `transit.active_feed_id()` | Aktive Fahrplanversion |
| `transit.service_time(date, seconds)` | GTFS-Zeit → Zeitstempel, DST-korrekt |
| `transit.active_service_ids(feed, date)` | Betriebskalender inkl. Ausnahmen |
| `transit.stops_nearby(...)` | Haltestellen im Umkreis, nach Distanz sortiert |
| `transit.departures(...)` | Abfahrtstafel für mehrere Halte |
| `transit.find_trip_candidates(...)` | Kandidaten der Fahrtenerkennung |
| `transit.search_places(...)` | Unscharfe Suche über Halte und Linien |

`search_places` kombiniert drei Verfahren: `similarity()` für Tippfehler,
`word_similarity()` für kurze Begriffe in langen Zielstrings („IC 3" in
„IC 3 Zürich HB – Basel SBB") und einen Präfixvergleich ohne Leerzeichen, damit
„IC3" die Linie „IC 3" findet.

## Row Level Security

RLS ist auf allen `public`-Tabellen aktiv.

- **Eigene Daten** (Geräte, Einstellungen, Favoriten, Sessions): volle Kontrolle
  durch den Nutzer.
- **`reports`**: lesbar sind aktive Meldungen sowie die eigenen — auch
  shadow-geflaggte, damit der Autor den Unterschied nicht bemerkt.
- **Schreibrechte auf `reports`, `report_votes`, `report_flags` gibt es
  bewusst nicht.** Jede Änderung läuft über die API, wo Missbrauchsschutz,
  Trust-Berechnung und Rate Limiting greifen. Ein direkter Schreibversuch mit
  dem Anon-Key läuft ins Leere.
- **Admin-Tabellen**: lesbar nur für Moderation bzw. Administration,
  `abuse_signals` gar nicht (nur Service Role).

`admin_audit_logs` ist append-only: ein Trigger verhindert `UPDATE` und
`DELETE`. Der Retention-Job deaktiviert ihn kurzzeitig und aktiviert ihn
anschliessend wieder — ein Integrationstest prüft genau das.

## Tabellenübersicht

**Identität**: `profiles`, `devices`, `user_settings`, `push_subscriptions`, `favorites`

**Fahrplan** (versioniert): `gtfs_imports`, `feed_info`, `agencies`, `routes`,
`calendar`, `calendar_dates`, `shapes`, `stops`, `trips`, `stop_times`, `transfers`

**Echtzeit**: `realtime_trip_updates`, `realtime_stop_time_updates`,
`service_alerts`, `service_alert_entities`, `feed_health`

**Community**: `report_categories`, `reports`, `report_votes`, `report_flags`,
`trip_sessions`, `trip_follows`, `user_reputation_events`, `abuse_signals`,
`notification_queue`

**Administration**: `moderation_actions`, `admin_audit_logs`, `feature_flags`,
`app_config`, `schema_migrations`
