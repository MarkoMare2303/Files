# ÖV-Daten

Alle Fahrplandaten stammen von **opentransportdata.swiss**, der offiziellen
Open-Data-Plattform für den Schweizer öffentlichen Verkehr. Sie deckt alle
konzessionierten Betreiber ab — SBB, BLS, SOB, RhB, PostAuto, VBZ, BVB, TL, TPG
und Hunderte weitere.

## Zugangsdaten

| Variable | Wofür | Beschaffung |
|----------|-------|-------------|
| `OPENTRANSPORTDATA_API_KEY` | GTFS-RT (Verspätungen, Ausfälle) und Service Alerts | Kostenloses Konto unter <https://opentransportdata.swiss/de/register/>, danach unter „Meine Konten" ein API-Token erzeugen |
| `OJP_API_KEY` | Verbindungssuche mit Umstiegen | Separater Token für den OJP-Endpunkt derselben Plattform |

Der **GTFS-Static-Download braucht keinen Key** — der Import funktioniert ohne
jede Registrierung.

Ohne diese Keys läuft die Anwendung weiter, mit klar benannten Einschränkungen:
keine Verspätungen, keine offiziellen Störungen, Verbindungssuche nur für
Direktverbindungen. Der Zustand steht unter `/ready`, im Admin-Dashboard und in
`GET /v1/app-config` unter `dataSources`.

## GTFS Static

### Import

```bash
pnpm gtfs:import                 # Standardquelle aus GTFS_STATIC_URL
pnpm gtfs:import --url <URL>     # abweichende Quelle
pnpm gtfs:import --force         # auch bei unveränderter Prüfsumme
pnpm gtfs:import --rows 50000    # nur erste N Zeilen je Datei (Diagnose)
```

Der Worker führt den Import zusätzlich nach Zeitplan aus (`GTFS_IMPORT_CRON`,
Vorgabe 03:00 Uhr).

### Ablauf

1. **Download**: streamend auf Platte, nie vollständig im Speicher. Der
   Schweizer Gesamtdatensatz ist mehrere hundert MB gross. SHA-256 wird
   nebenher berechnet.
2. **Prüfsummenvergleich**: Stimmt sie mit der aktiven Version überein, endet
   der Import ohne Änderung.
3. **Neue Feed-Version** in `transit.gtfs_imports` mit Status `IMPORTING`.
4. **Einlesen** je Datei per `COPY ... FROM STDIN`. Zeilenweise `INSERT`s wären
   bei ~15 Mio. `stop_times` um Grössenordnungen zu langsam.
5. **Geometrien**: `stops` und `shapes` laufen über UNLOGGED-Staging-Tabellen,
   weil daraus PostGIS-Objekte in zwei Bezugssystemen entstehen (WGS84 für die
   Ausgabe, LV95 für metrische Berechnungen).
6. **Denormalisierung**: `trips.start_seconds`, `end_seconds`, `first_stop_id`,
   `last_stop_id`, `stop_count` werden aus `stop_times` berechnet. Das erspart
   im heissen Pfad je einen Aggregat-Join.
7. **`ANALYZE`** auf allen grossen Tabellen. Ohne aktuelle Statistiken wählt
   der Planer für die Kandidatensuche Sequential Scans — Faktor 100 langsamer.
8. **Aktivierung**: In einer Transaktion wird die alte Version `SUPERSEDED`,
   die neue `ACTIVE`. Ein partieller Unique-Index erzwingt, dass höchstens eine
   Version aktiv ist. **Während des gesamten Imports bleibt die alte Version
   ausgeliefert — keine Ausfallzeit.**
9. **Aufräumen**: ältere Versionen werden entfernt (Vorgabe: 2 aufbewahren).

### Versionierung

Jede Zeile in `transit.*` trägt eine `feed_id`. Abfragen filtern über
`transit.active_feed_id()`. Community-Daten referenzieren dagegen **GTFS-IDs
als Text ohne Fremdschlüssel** — sonst würde ein Feed-Wechsel Meldungen
kaskadierend löschen. Eine konkrete Fahrt wird nach GTFS-RT-Konvention über
`trip_id + service_date` identifiziert.

## GTFS Realtime

Der Worker pollt alle 30 Sekunden (`GTFS_RT_POLL_INTERVAL_SECONDS`).

- **Protocol Buffers**, nicht JSON. Dekodiert mit `gtfs-realtime-bindings`.
- **Trip Updates** → `realtime_trip_updates` + `realtime_stop_time_updates`,
  Schlüssel `(trip_id, start_date)`.
- **Verspätung**: bevorzugt das `delay`-Feld des TripUpdate, sonst der erste
  Stop-Time-Update mit Angabe.
- **Veraltete Einträge** werden nach 20 Minuten gelöscht. Eine 40 Minuten alte
  Prognose ist keine Prognose mehr.
- **Fehlerbehandlung**: Timeouts, Redirects, Retry mit exponentiellem Backoff
  und Jitter, Auswertung von `Retry-After`. Jeder Lauf schreibt nach
  `transit.feed_health`.

Antwortet der Endpunkt mit HTML statt Protobuf (typisch bei falschem Key),
enthält die Fehlermeldung den Beginn der Antwort — das erspart Ratespiele.

## Service Alerts

Offizielle Störungsmeldungen der Betreiber, ebenfalls als GTFS-RT.

- Mehrsprachige Texte (`TranslatedString`) werden als JSONB abgelegt; Deutsch
  ist der garantierte Fallback.
- Betroffene Linien, Halte, Fahrten und Betreiber landen in
  `service_alert_entities` und sind einzeln indiziert.
- Nicht mehr im Feed enthaltene Meldungen werden als beendet markiert, nicht
  gelöscht — die Historie bleibt nachvollziehbar.

**Diese Meldungen liegen in einer anderen Tabelle als Community-Meldungen.**
Die Trennung ist strukturell, nicht konventionell: eine Verwechslung ist
technisch ausgeschlossen. In der API tragen sie `source: "OFFICIAL"`, in der
App eine eigene Farbe, ein eigenes Label und eine eigene Kartenform.

## Verbindungssuche

Hinter `JourneyPlannerProvider` stehen zwei Implementierungen:

**`OjpJourneyPlannerProvider`** — Open Journey Planner 2.0, SIRI/OJP-XML per
POST. Vollwertig inklusive Umstiegen, Fusswegen und Echtzeitprognosen. Der
Antwort-Parser ist gegen eine strukturgetreue Fixture getestet und funktioniert
damit auch ohne Zugang nachweisbar.

**`GtfsDirectJourneyProvider`** — Direktverbindungen aus den eigenen GTFS-Daten:
Fahrten, die Start und Ziel in der richtigen Reihenfolge bedienen, inklusive
Echtzeitverspätung. Für die meisten innerstädtischen Verbindungen und alle
IC/IR-Relationen liefert das echte, korrekte Ergebnisse.

`JourneyPlanner` wählt automatisch: OJP wenn verfügbar, sonst Direktverbindungen.
Fällt OJP während einer Anfrage aus, wird zurückgefallen. Die verwendete Quelle
und ihre Einschränkungen stehen in jeder Antwort (`provider`, `limitations`) und
werden in der App angezeigt.

## Grösse und Laufzeit

Richtwerte für den Schweizer Gesamtdatensatz:

| Kennzahl | Grössenordnung |
|----------|----------------|
| Haltestellen | ~ 30'000 |
| Linien | ~ 3'500 |
| Fahrten | ~ 900'000 |
| `stop_times` | ~ 15 Mio. |
| Import-Dauer | 10–25 Minuten (hardwareabhängig) |
| Datenbankgrösse je Version | 6–10 GB inkl. Indizes |

Bei zwei aufbewahrten Versionen ist mit 15–25 GB zu rechnen.
