# Architektur

## Überblick

```text
┌──────────────┐        ┌──────────────┐
│  Mobile App  │        │ Admin-Portal │
│ Expo / RN    │        │ Next.js      │
└──────┬───────┘        └──────┬───────┘
       │  REST + Bearer-Token  │
       ▼                       ▼
┌────────────────────────────────────────┐
│           apps/api  (Fastify)          │
│  Auth · Geo-Queries · Trip-Matching    │
│  Missbrauchsschutz · Moderation        │
└───────┬───────────────────────┬────────┘
        │                       │
        ▼                       ▼
┌──────────────────┐   ┌──────────────────┐
│ PostgreSQL       │   │ Redis (optional) │
│ + PostGIS        │   │ Cache            │
└────────▲─────────┘   └──────────────────┘
         │
┌────────┴─────────┐        ┌──────────────────────────┐
│ apps/worker      │───────▶│ opentransportdata.swiss  │
│ Import · Poller  │        │ GTFS · GTFS-RT · OJP     │
│ Push · Retention │        └──────────────────────────┘
└──────────────────┘
```

Supabase liefert Auth (Apple, Google, E-Mail) und Realtime. Die Mobile-App
abonniert Änderungen an `public.reports` gefiltert nach Fahrt, Linie oder
Station — nie den gesamten Datenstrom.

## Warum diese Aufteilung

**API und Worker sind getrennt.** Der GTFS-Import der gesamten Schweiz läuft
Minuten und schreibt Millionen Zeilen. Liefe er im API-Prozess, würden
Antwortzeiten während des Imports einbrechen. Die Trennung erlaubt ausserdem,
beide unabhängig zu skalieren: die API horizontal nach Last, den Worker als
einzelne Instanz.

**Domänenlogik liegt in `packages/shared`, nicht in der API.** Trip-Scoring,
Trust Score, TTL-Berechnung und Missbrauchsheuristiken sind reine Funktionen
ohne I/O. Dadurch sind sie vollständig unit-testbar (115 Tests, keine Datenbank
nötig) und lassen sich in der App wiederverwenden.

**Geo-Abfragen laufen in PostGIS, nicht in der Anwendung.** Die
Kandidatensuche für die Fahrtenerkennung filtert Millionen Fahrten auf wenige
Dutzend — das gehört an die Daten, nicht über das Netz. Die Bewertung dieser
Kandidaten passiert danach in Node, weil sie fachlich komplex und testbar sein
muss.

**Schreibzugriffe auf Community-Daten gehen ausschliesslich über die API.** Es
gibt bewusst keine RLS-Policy, die der Mobile-App direktes `INSERT` auf
`reports` erlaubt. Sonst liessen sich Rate Limits, Duplikatserkennung und
Plausibilitätsprüfungen umgehen.

## Pakete

| Paket | Zweck | Abhängigkeiten |
|-------|-------|----------------|
| `@swissov/types` | Zod-Schemas als API-Vertrag; daraus abgeleitete TS-Typen | – |
| `@swissov/config` | Validierte Umgebungskonfiguration je App | types |
| `@swissov/shared` | Geo-Mathematik, Trip-Scoring, Trust, Reputation, Abuse | types |
| `@swissov/database` | Migrationen, Runner, Seeds, `pg`-Zugriffsschicht | config, shared, types |
| `@swissov/transit` | GTFS-Import, GTFS-RT, Service Alerts, Journey-Provider | database, shared, types |
| `@swissov/ui` | Design Tokens für Mobile und Admin | – |

Die Abhängigkeiten sind azyklisch und laufen nur in eine Richtung: von den
Apps zu den Paketen, innerhalb der Pakete von speziell zu allgemein.

## Datenfluss: Von der Position zur Meldung

1. Die App sammelt bis zu fünf GPS-Punkte im Speicher (kein Verlauf auf Platte).
2. `POST /v1/trip-detection` schickt diese Punkte. Der Server sucht per PostGIS
   Streckenverläufe im Umkreis, schränkt auf aktive Betriebstage und das
   Zeitfenster ein und liefert Kandidaten samt Projektion, Nachbarhalten und
   Sollposition.
3. `scoreCandidates()` aus `@swissov/shared` bewertet sie; `decideDetection()`
   entscheidet: automatisch übernehmen, bestätigen lassen oder auswählen lassen.
4. Bestätigt der Nutzer, entsteht eine `trip_session`. Sie ist der Kontext für
   alle folgenden Meldungen.
5. `POST /v1/reports` leitet Linie, Betreiber, Richtung und Nachbarhalte aus
   der Session ab, prüft auf Missbrauch, berechnet TTL und Trust Score und
   verteilt die Meldung über Supabase Realtime.

## Fehlerbehandlung

Ein Fehlerkatalog in `packages/shared/src/errors.ts` bildet jeden Fehlerfall auf
einen stabilen Code, eine technische Meldung (Logs) und einen mehrsprachigen
Endnutzertext ab. Die API liefert immer beides; die App zeigt ausschliesslich
`userMessage`. Stacktraces und SQL-Fehler verlassen den Server nie.

Externe Ausfälle degradieren, statt zu blockieren:

| Ausfall | Verhalten |
|---------|-----------|
| GTFS-RT nicht erreichbar | Fahrplanzeiten ohne Verspätung, Hinweis in der UI |
| OJP nicht erreichbar/kein Key | Direktverbindungen aus eigenen GTFS-Daten, Einschränkung ausgewiesen |
| Redis nicht erreichbar | In-Memory-Cache, keine Fehler nach aussen |
| Supabase Realtime nicht konfiguriert | Listen aktualisieren sich über Polling |
| Keine Verbindung im Client | Zwischengespeicherte Daten, Meldungen in Offline-Queue |

## Tests

| Ebene | Umfang | Ort |
|-------|--------|-----|
| Unit | 213 Tests, keine externen Dienste | alle Pakete + `apps/mobile` |
| Integration | 54 Tests gegen echtes PostgreSQL/PostGIS | `apps/api`, `apps/worker` |

Die Integrationstests legen einen kleinen, klar als Fixture markierten
GTFS-Feed mit echten Schweizer Bahnhofskoordinaten an und prüfen den gesamten
Ablauf: Haltestellensuche, Abfahrten, Fahrtenerkennung, Meldung erstellen,
sehen, bestätigen, melden, moderieren, Konto löschen.

Ende-zu-Ende-Tests auf echten Geräten (Detox/Maestro) sind **nicht** enthalten —
sie brauchen einen nativen Build und damit Apple- bzw. Google-Credentials. Die
abgedeckten Abläufe sind in `IMPLEMENTATION_STATUS.md` aufgeführt.
