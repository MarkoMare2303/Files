# Fahrtenerkennung

## Das Problem

Für Schweizer Züge, Busse und Trams gibt es **keine flächendeckenden
öffentlichen GPS-Fahrzeugpositionen**. GTFS-Realtime liefert Verspätungen und
Ausfälle, aber in aller Regel keine `VehiclePosition`-Nachrichten. Die Frage
„In welchem Fahrzeug sitze ich gerade?" lässt sich deshalb nicht durch einen
Abgleich mit Fahrzeugpositionen beantworten.

Stattdessen wird sie aus dem rekonstruiert, was tatsächlich verfügbar ist:
Fahrplan, Streckenverlauf, Betriebskalender, Echtzeitverspätungen — und den
GPS-Punkten des Geräts.

## Zweistufiges Verfahren

### Stufe 1 — Kandidatensuche (PostgreSQL/PostGIS)

`transit.find_trip_candidates(lat, lon, at, radius, limit, prev_lat, prev_lon, route_types)`

1. **Streckenverläufe im Umkreis**: GIST-Index auf `shapes.geom_lv95`
   (EPSG:2056, metrisch). `ST_DWithin` reduziert schweizweit ~100'000 Shapes
   auf wenige Dutzend.
2. **Betriebstage**: heute und gestern — eine Fahrt um 00:30 kann zum
   Betriebstag des Vortags gehören (GTFS-Zeit 24:30). `active_service_ids()`
   wertet `calendar` und `calendar_dates` aus.
3. **Zeitfenster**: über die beim Import denormalisierten Spalten
   `trips.start_seconds` / `end_seconds`, mit 5 Minuten Vorlauf und
   15 Minuten Nachlauf für Verspätungen.
4. **Anreicherung** je Kandidat:
   - `ST_Distance` zur Linie (Meter)
   - `ST_LineLocatePoint` → Fortschritt 0..1
   - `ST_Azimuth` → Streckenrichtung an der Projektionsstelle
   - letzter passierter und nächster Halt aus `stop_times`
   - **Sollposition**: zwischen beiden Halten zeitanteilig entlang der Linie
     interpoliert

Die Sollposition ist der Kern der Zeitbewertung: Sie beantwortet „wo müsste
dieses Fahrzeug jetzt sein?" und lässt sich direkt mit der Messung vergleichen.

### Stufe 2 — Bewertung (`packages/shared/src/detection/scoring.ts`)

Reine Funktionen ohne I/O, vollständig unit-getestet.

| Teilscore | Gewicht | Verfahren |
|-----------|---------|-----------|
| `shapeDistance` | 30 % | Lorentz-Kurve `1/(1+(d/tol)²)`; Toleranz je Fahrzeugtyp (Bahn 70 m, Tram 40 m, Bus 60 m, Schiff 150 m); die halbe GPS-Ungenauigkeit wird als zusätzliche Toleranz gutgeschrieben |
| `timeCompatibility` | 25 % | 50 % Fahrtfenster (weiche Ränder), 50 % Abstand zur Sollposition |
| `directionCompatibility` | 15 % | `(1+cos δ)/2` zwischen Kurs und Streckenrichtung; Kurs aus dem Gerät oder aus dem Positionsverlauf |
| `speedCompatibility` | 10 % | Profil je Fahrzeugtyp; Stillstand = 0.75 (plausibel), oberhalb der Bauartgrenze = 0 |
| `stopSequence` | 10 % | Fortschritt entlang der Linie zwischen erster und letzter Beobachtung; Rückwärtsbewegung ≈ 0 |
| `realtimeCompatibility` | 10 % | Ausfall ≈ 0; aktuelle Daten und passende Prognose erhöhen |

Die Gewichte sind über `app_config.detection.weights` im Admin-Portal änderbar.
Die Summe wird normalisiert — eine Fehlkonfiguration kann das Ergebnis nicht
aus dem Bereich 0..1 schieben.

**Neutralwert 0.6 statt 1.0 bei fehlender Datengrundlage.** Ein Feed ohne
Echtzeitdaten soll eine Fahrt weder bestrafen noch bestätigen. Ein Neutralwert
von 1.0 würde fehlende Evidenz wie bestätigte Evidenz behandeln.

## Entscheidung

```text
confidence ≥ 0.90  und  Abstand zum Zweitplatzierten ≥ 0.08  → AUTO_SELECT
confidence ≥ 0.90  aber knapper Abstand                      → CONFIRM
0.70 ≤ confidence < 0.90                                     → CONFIRM
0.20 < confidence < 0.70                                     → CHOOSE
sonst                                                        → NONE
```

Das **Abstandskriterium** ist wichtig: Auf der Strecke Zürich–Olten fahren
S-Bahn und IC teilweise parallel auf derselben Trasse. Ohne Abstandsprüfung
würde die App eine Zufallsentscheidung als Gewissheit ausgeben. Liegen zwei
Kandidaten nahe beieinander, wird gefragt statt geraten.

## Der Nutzer wird nie ausgesperrt

Auch bei `NONE` bleibt „Meine Fahrt auswählen" erreichbar: Haltestelle suchen →
nächste Abfahrten → Fahrt antippen. Die Sitzung erhält dann
`detectionMethod: MANUAL` und eine Confidence von 1.0 — der Nutzer weiss es
besser als das Modell.

## Datensparsamkeit

- Es werden höchstens **10 Punkte** übertragen (Schema-Limit), die App sendet 5.
- Die Punkte werden **nicht gespeichert** — weder in der Datenbank noch im Log
  (Pino redigiert `req.body.observations`).
- Die Trip-Session hält **eine** letzte Position für Plausibilitätsprüfungen.
  Beim Beenden wird sie auf `NULL` gesetzt. Es entsteht keine Bewegungshistorie.

## Testszenarien

`packages/shared/src/detection/fixtures.ts` (klar als Testdaten markiert):

| Szenario | Prüft |
|----------|-------|
| IC Zürich HB → Basel SBB, 87 km/h westwärts, 17:38 | Grundfall aus der Spezifikation; erreicht ≥ 0.90 |
| Gegenrichtung Basel → Zürich | Richtungsbewertung; Abstand > 0.15 zum richtigen Kandidaten |
| Tram 10 in Zürich bei 87 km/h | Geschwindigkeitsausschluss: Score 0 |
| Gemischtes Feld aus 6 Kandidaten | Der richtige gewinnt, Entscheidung `AUTO_SELECT` |
| Tram innerhalb Zürichs | Erkennung bei niedriger Geschwindigkeit |
| Bus in Basel | Erkennung im dichten Stadtnetz |
| PostAuto Chur–Thusis, 90 m GPS-Ungenauigkeit | Ländlicher Raum mit schlechtem Empfang |
| IC 1 Bern → Zürich | Zweite Fernverkehrsrelation |
| Fahrt, die noch nicht begonnen hat | Zeitfenster greift; Score < 0.70 |
| Ausgefallene Fahrt (GTFS-RT) | Score bricht ein |

Zusätzlich prüfen die Integrationstests in `apps/api` die Erkennung gegen eine
echte PostGIS-Datenbank mit importierten Fixture-Fahrplandaten.

## Bekannte Grenzen

- **Tunnel**: Ohne GPS bleibt die letzte Position stehen. Die Zeitbewertung
  trägt die Erkennung eine Weile, danach greift die manuelle Auswahl.
- **Parallelverkehr**: Siehe Abstandskriterium — bewusst Rückfrage statt Raten.
- **Fahrten ohne `shape_id`**: Ohne Streckenverlauf entfällt die
  Distanzbewertung (Neutralwert). Im Schweizer Feed betrifft das wenige Fahrten.
- **Ersatzverkehr**: Fährt ein Bus die Strecke eines Zuges, passt der
  Streckenverlauf nicht. Hier hilft nur die manuelle Auswahl.
