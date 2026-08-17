# Fahrplandaten anbinden

Diese Seite beantwortet genau eine Frage: **Wie kommen echte Schweizer
Fahrplandaten in die App?**

---

## 1. Die Datenquellen

| Dienst im Portal | Wofür | Variable | Pflicht |
| --- | --- | --- | --- |
| **CKAN** | Fahrplan-Download (GTFS Static): Haltestellen, Linien, Fahrten, Zeiten | `OPENTRANSPORTDATA_CKAN_API_KEY` | **ja** |
| **GTFS-RT** | Verspätungen, Ausfälle | `OPENTRANSPORTDATA_GTFS_RT_API_KEY` | nein |
| **GTFS-SA** | offizielle Störungsmeldungen | `OPENTRANSPORTDATA_GTFS_SA_API_KEY` | nein |
| **OJP 2.0** | Verbindungssuche mit Umstiegen | `OJP_API_KEY` | nein |

Nicht verwendet: **SIRI-PT** (`siri_pt_plan`) und **SIRI-ET** (`siri_et_plan`).
Die App liest Soll- und Ist-Fahrplan aus den GTFS-Feeds; ein zusätzliches
SIRI-Abonnement bringt ihr nichts.

> **Ein Schlüssel reicht nicht.** opentransportdata.swiss vergibt Tokens
> **pro registrierter Anwendung**, nicht pro Konto: für jeden Dienst wird im
> Portal eine eigene Anwendung angelegt, mit eigener App-ID und eigenem Token.
> Ein Token am falschen Endpunkt antwortet mit 401/403 — das sieht aus wie ein
> abgelaufener Schlüssel, ist aber nur der falsche.

Wer nur einen Schlüssel hat, kann `OPENTRANSPORTDATA_API_KEY` setzen: dieser
Wert greift überall dort, wo keine dienstspezifische Variable gesetzt ist. Für
OJP gilt der Rückfall bewusst **nicht** — siehe Abschnitt 2.

Die URLs (`GTFS_STATIC_URL`, `GTFS_RT_TRIP_UPDATES_URL`,
`GTFS_RT_SERVICE_ALERTS_URL`, `OJP_ENDPOINT_URL`) sind vorbelegt und müssen nur
zum Fahrplanwechsel angefasst werden. Der Permalink für den statischen Datensatz
antwortet mit einer Weiterleitung auf die eigentliche ZIP-Datei; der Importer
folgt ihr.

> Der Datensatzname enthält das Fahrplanjahr (`timetable-2025-…`). Zum
> Fahrplanwechsel im Dezember ändert er sich — dann `GTFS_STATIC_URL`
> anpassen. `pnpm gtfs:verify-production` meldet einen 404, wenn die URL
> veraltet ist.

---

## 2. Schlüssel eintragen

Im Portal unter „Meine Konten" je Dienst eine Anwendung registrieren und das
Token übernehmen:

```bash
# Kostenlos registrieren: https://opentransportdata.swiss
OPENTRANSPORTDATA_CKAN_API_KEY=<token der CKAN-Anwendung>
OPENTRANSPORTDATA_GTFS_RT_API_KEY=<token der GTFS-RT-Anwendung>
OPENTRANSPORTDATA_GTFS_SA_API_KEY=<token der GTFS-SA-Anwendung>

# Optional, eigener Dienst:
OJP_API_KEY=<token der OJP-2.0-Anwendung>
```

Der **Token-Hash**, den das Portal neben jedem Token anzeigt, wird nicht
gebraucht — er dient dem Wiedererkennen im Portal, nicht der Authentifizierung.
Ebensowenig die App-ID.

**Warum OJP keinen Rückfall auf `OPENTRANSPORTDATA_API_KEY` hat:** OJP ist
optional. Würde dort ein generischer Schlüssel eingesetzt, meldete
`/v1/app-config` die Verbindungssuche als aktiv, und jede Anfrage liefe in ein
401 — „konfiguriert, aber kaputt" statt schlicht „nicht aktiv". Ohne
`OJP_API_KEY` schaltet die App sichtbar auf die Fahrplan-Direktsuche um.

**Zum Authentifizierungsverfahren:** Die Plattform hat es im Lauf der Zeit
geändert, und nicht alle Endpunkte verhalten sich gleich. Der Code probiert
deshalb bei einer Zurückweisung (401/403) automatisch drei Formen durch:

```text
bearer   Authorization: Bearer <key>     ← Standard, wird zuerst versucht
raw      Authorization: <key>            ← ältere GTFS-RT-Endpunkte
header   Authorization + apikey: <key>   ← manche Gateways
```

Wer das richtige Verfahren kennt, setzt es fest und spart die zusätzlichen
Anfragen:

```bash
OPENTRANSPORTDATA_AUTH_SCHEME=bearer
```

---

## 3. Erreichbarkeit prüfen

```bash
pnpm gtfs:verify-production
```

Das Skript lädt nichts herunter und schreibt nichts in die Datenbank. Es prüft
jeden Dienst mit **seinem eigenen** Schlüssel und deutet jeden Fehler:

```text
✓ Zugangsdaten CKAN (Fahrplan-Download)     eyJv…J9 (120 Zeichen) — aus OPENTRANSPORTDATA_CKAN_API_KEY
✓ Zugangsdaten GTFS-RT (Verspätungen)       eyJv…J9 (120 Zeichen) — aus OPENTRANSPORTDATA_GTFS_RT_API_KEY
✓ Zugangsdaten GTFS-SA (Störungsmeldungen)  eyJv…J9 (120 Zeichen) — aus OPENTRANSPORTDATA_GTFS_SA_API_KEY

✓ GTFS-Static (Fahrplan-Datensatz)          erreichbar — 412.7 MB
✓ GTFS-RT TripUpdates (Verspätungen)        1284 KB Protocol Buffers
✓ GTFS-RT ServiceAlerts                     87 KB Protocol Buffers
○ OJP 2.0 (Verbindungssuche)                nicht konfiguriert
```

Steht dort `— aus OPENTRANSPORTDATA_API_KEY (Rückfall)`, greift für diesen
Dienst der generische Schlüssel. Das ist zulässig, aber selten beabsichtigt;
das Skript weist darauf hin, wenn alle Dienste denselben Wert benutzen.

Bei HTTP 403 unterscheidet die Ausgabe zwei Ursachen: fehlende Freischaltung
des Datensatzes im Portal, oder ein Proxy zwischen Server und Internet. In
Container-Umgebungen ist Letzteres der häufigere Grund.

---

## 4. Importieren

```bash
pnpm db:migrate      # Schema anlegen bzw. aktualisieren
pnpm db:seed         # Kategorien, Feature-Flags, Konfiguration
pnpm gtfs:import     # der eigentliche Import
```

**Dauer und Platzbedarf:** 10–40 Minuten, rund 8 GB in der Datenbank. Der
Import läuft in eine neue Feed-Version und schaltet erst am Ende um — die App
bleibt währenddessen mit den alten Daten benutzbar.

Nützliche Schalter:

```bash
pnpm gtfs:import --force              # auch bei unveränderter Prüfsumme
pnpm gtfs:import --rows 50000         # nur die ersten N Zeilen je Datei
pnpm gtfs:import --url <andere-url>   # abweichende Quelle
pnpm gtfs:import --file ./gtfs.zip    # bereits heruntergeladene Datei
```

### `--file`: wenn der Server das Portal nicht erreicht

Läuft der Server hinter einem Proxy, der `opentransportdata.swiss` blockiert,
muss der Import nicht scheitern:

```bash
# 1. Datensatz irgendwo mit Netzzugang herunterladen (Browser genügt)
# 2. Datei auf den Server kopieren
# 3. Importieren
pnpm gtfs:import --file /pfad/zu/gtfs.zip
```

Der Import ist danach identisch — inklusive Prüfsumme, Feed-Versionierung und
atomarer Aktivierung.

---

## 5. Nachprüfen, ob der Import etwas taugt

```sql
SELECT (SELECT count(*) FROM transit.stops)      AS haltestellen,
       (SELECT count(*) FROM transit.routes)     AS linien,
       (SELECT count(*) FROM transit.trips)      AS fahrten,
       (SELECT count(*) FROM transit.stop_times) AS halte;
```

Erwartungsbereich für den vollständigen Schweizer Datensatz:

| Tabelle | Grössenordnung |
| --- | --- |
| `transit.stops` | 25 000 – 40 000 |
| `transit.routes` | 2 000 – 4 000 |
| `transit.trips` | 800 000 – 1 500 000 |
| `transit.stop_times` | 12 000 000 – 20 000 000 |

Dann über die API:

```bash
curl "http://localhost:3001/v1/search?q=Zurich&limit=3"
curl "http://localhost:3001/v1/stops/8503000/departures?limit=5"
```

Die Abfahrtstafel muss **„Zürich HB"** zeigen und die Gleisnummer im eigenen
Feld — nicht „Zürich HB, Gleis 31" als Haltestellenname. Der Schweizer
Datensatz referenziert in `stop_times` die Kante, nicht die Station; die
Auflösung auf den Stationsnamen passiert in `transit.departures()`.

---

## 6. Echtzeitdaten

Der Worker fragt die beiden GTFS-RT-Feeds selbstständig ab
(`GTFS_RT_POLL_INTERVAL_SECONDS`, Standard 30 s):

```bash
pnpm worker:dev
```

Ob die Kette funktioniert, zeigt `GET /v1/app-config`:

```json
"dataSources": { "timetable": true, "realtime": true, "officialAlerts": true }
```

`realtime: false` bedeutet: seit über 10 Minuten kein erfolgreicher Abruf. Die
App zeigt dann ehrlich „Echtzeitdaten sind gerade nicht verfügbar" und
kennzeichnet alle Zeiten als FAHRPLAN.

### Die Kette ohne Netzzugang prüfen

```bash
pnpm gtfs:verify-realtime
```

Erzeugt einen echten GTFS-RT-Feed, serviert ihn lokal über HTTP und lässt den
unveränderten Produktivpfad darauf los: Authentifizierung, Dekodierung,
Betriebstag-Auflösung, Schreiben in die Datenbank. Damit ist alles geprüft
ausser der Erreichbarkeit des Portals selbst.

---

## 7. Fahrplanwechsel

Der Datensatz ändert sich täglich (kleine Korrekturen) und jährlich im
Dezember (neuer Fahrplan). Der Worker importiert nachts automatisch
(`GTFS_IMPORT_CRON`, Standard `0 3 * * *`) und überspringt den Import, wenn
die Prüfsumme unverändert ist. Ältere Feed-Versionen werden aufgeräumt; zwei
bleiben als Rückfallebene stehen.

Community-Meldungen überleben einen Feed-Wechsel: sie speichern GTFS-IDs als
Text ohne Fremdschlüssel, damit das Ersetzen des Fahrplans keine Nutzerdaten
mitlöscht.

---

## 8. Entwicklung ohne Zugangsdaten

Für Entwicklung und Tests gibt es einen kleinen, strukturell echten Datensatz
— reale Haltestellenkoordinaten, elf Linien quer durch die Schweiz,
Taktverkehr über den ganzen Tag:

```bash
node scripts/make-dev-gtfs.mjs tmp/dev-gtfs.zip
pnpm gtfs:import --file tmp/dev-gtfs.zip --force
```

⚠️ **Das ist nicht der Schweizer Fahrplan.** Die Fahrzeiten sind erfunden. Der
Feed trägt `feed_publisher_name = "ENTWICKLUNGSDATEN — NICHT ECHT"`, damit er
in der Datenbank als solcher erkennbar ist. Für den Produktivbetrieb ist
ausschliesslich der Import aus Abschnitt 4 zulässig.
