# Live-Test in der Schweiz

**Zweck:** Prüfen, ob die App im echten Schweizer ÖV funktioniert — mit echten
Fahrplandaten, echtem GPS, echten Tunnels und echtem Funkloch.

**Voraussetzung:** Alle Punkte aus `PRODUCTION_READINESS.md` Abschnitt 3 sind erledigt,
der Fahrplan ist importiert, API und Worker laufen.

**Warum das nötig ist:** Die automatisierten Tests laufen gegen vereinfachte Streckenzüge
(Geraden zwischen Halten) und synthetische Fahrpläne. Echte Schweizer Shapes haben Kurven,
echte GPS-Signale springen, echte Züge stehen manchmal ohne Grund. Was in
`scenarios.test.ts` grün ist, ist damit **noch nicht** in der Wirklichkeit bewiesen.

---

## Vorbereitung

```bash
# Fahrplan da? Sonst hat der ganze Test keinen Sinn.
psql "$DATABASE_URL" -c "
  SELECT (SELECT count(*) FROM transit.stops)      AS haltestellen,
         (SELECT count(*) FROM transit.routes)     AS linien,
         (SELECT count(*) FROM transit.trips)      AS fahrten,
         (SELECT count(*) FROM transit.stop_times) AS halte;
"
```

Erwartungsbereich für einen vollständigen Schweizer Datensatz:

| Tabelle | Grössenordnung |
| --- | --- |
| `transit.stops` | 25 000 – 40 000 |
| `transit.routes` | 2 000 – 4 000 |
| `transit.trips` | 800 000 – 1 500 000 |
| `transit.stop_times` | 12 000 000 – 20 000 000 |

Deutlich kleinere Zahlen bedeuten meist: Es wurde ein Teildatensatz oder ein
Testdatensatz importiert.

Auf dem Telefon: App über HTTPS öffnen, zum Home-Bildschirm hinzufügen, Standort
erlauben, anmelden.

---

## Protokollvorlage

Für jede Fahrt ausfüllen. Ein Screenshot pro Zeile hilft bei der Auswertung.

| # | Datum/Zeit | Linie | Von → Nach | Erkannt? | Konfidenz | Entscheidung | GPS-Qualität | Bemerkung |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | ja/nein/falsch | | AUTO/CONFIRM/CHOOSE/NONE | gut/mittel/schlecht | |

---

## Teil A — Fernverkehr (Pflicht)

| # | Strecke | Worauf zu achten ist |
| --- | --- | --- |
| A1 | IC Zürich HB → Bern | Standardfall. Erkennung sollte innerhalb von 2 Minuten nach Abfahrt greifen. |
| A2 | IC Bern → Zürich HB | Gegenrichtung. **Darf nicht** der Hinfahrt zugeordnet werden. |
| A3 | IC Zürich HB → Basel SBB (via Aarau/Olten) | Parallel verkehrende IR/S-Bahnen auf derselben Trasse. |
| A4 | IR Zürich HB → Chur | Lange Fahrt, Wechsel zwischen Tal und Berg. |
| A5 | IC Genève → Lausanne | Romandie; Oberflächensprache prüfen (fr). |
| A6 | IC Lugano → Bellinzona | Ticino; Oberflächensprache prüfen (it). |
| A7 | IR Brig → Sion → Lausanne | Wallis, enges Tal mit steilen Flanken. |
| A8 | Beliebige Fahrt durch den **Gotthard-Basistunnel** | 57 km ohne GPS. Die App darf die Fahrt nicht abbrechen und nicht auf eine andere Fahrt springen. |
| A9 | Beliebige Fahrt durch den **Lötschberg-Basistunnel** | Wie A8. |
| A10 | Fahrt mit ≥ 10 Minuten Verspätung | Wird die Verspätung angezeigt? Bleibt die Erkennung stabil? |

**Kritisch bei A8/A9:** Nach der Tunnelausfahrt darf die App die Fahrt nicht als beendet
markieren, nur weil zwischendurch keine Position vorlag. Erwartetes Verhalten: die
Sitzung bleibt aktiv, die Positionsanzeige wird nach dem Tunnel wieder aktuell.

---

## Teil B — Nahverkehr (Pflicht)

| # | Strecke | Worauf zu achten ist |
| --- | --- | --- |
| B1 | S-Bahn Zürich, beliebige Linie zur Hauptverkehrszeit | Dichter Takt, mehrere Kandidaten. Rückfrage statt Raten ist hier der Erfolg. |
| B2 | Tram Zürich (z. B. Linie 10) | Enge Toleranz (40 m), Häuserschluchten. |
| B3 | Tram Basel oder Genève | Zweite Stadt, andere Betreiberdaten. |
| B4 | Bus in einer Stadt (Bern, Luzern, St. Gallen) | Generalisierte Shapes, Haltestellen dicht beieinander. |
| B5 | PostAuto im ländlichen Raum | Wenig Verkehr, langer Abstand zwischen Halten. |
| B6 | PostAuto auf einer Passstrasse | Serpentinen — die Richtungsbewertung wird auf die Probe gestellt. |
| B7 | Metro m2 Lausanne | Untergrund; ähnlich Tunnel, aber mit kurzen Abschnitten. |
| B8 | Trolleybus | Eigener Fahrzeugtyp im Datensatz. |
| B9 | Kursschiff (Zürichsee, Vierwaldstättersee) | Grosse Toleranz (150 m), kaum Bebauung. |
| B10 | Bergbahn (Standseilbahn oder Luftseilbahn) | Sehr kurze Strecken, steile Höhenprofile. |

---

## Teil C — Falsch-Positiv-Prüfung (Pflicht)

**Dieser Teil ist der wichtigste.** Eine App, die immer etwas erkennt, ist unbrauchbar.

| # | Situation | Erwartetes Verhalten |
| --- | --- | --- |
| C1 | Auto auf der A1 parallel zur Bahnlinie Bern–Olten, ~120 km/h | **Keine** automatische Übernahme. |
| C2 | Auto auf der A3 parallel zur Strecke Zürich–Chur | **Keine** automatische Übernahme. |
| C3 | Velo entlang einer Tramstrecke in Zürich | **Keine** automatische Übernahme. |
| C4 | Zu Fuss entlang einer Buslinie | **Keine** automatische Übernahme. |
| C5 | Auf dem Bahnsteig stehend, 10 Minuten vor Abfahrt | Höchstens eine Rückfrage, keine automatische Übernahme. |
| C6 | Im Bahnhofsgebäude, ohne einzusteigen | Keine Fahrt. |
| C7 | Auto im Parkhaus neben einem Bahnhof | Keine Fahrt. |
| C8 | Zug verpasst — App offen lassen, Zug fährt ohne einen ab | Die Fahrt darf **nicht** weiterlaufen. |

**Wenn C1 oder C2 fehlschlägt** (also eine Autofahrt automatisch als Zugfahrt übernommen
wird), ist das ein Blocker. Bitte Rohdaten sichern:

```bash
# Beobachtungen aus der laufenden Sitzung abrufen (nur mit eigenem Token):
curl -s -H "Authorization: Bearer $TOKEN" \
     "$API_URL/v1/trip-sessions/current" | jq
```

und die Situation mit Ort, Uhrzeit, Geschwindigkeit und Abstand zur Bahnlinie
protokollieren. Daraus lässt sich ein neuer Fall in
`packages/shared/src/detection/scenarios.test.ts` bauen.

---

## Teil D — Meldungen und Community

| # | Prüfung | Erwartung |
| --- | --- | --- |
| D1 | Meldung während einer erkannten Fahrt absenden | Unter 5 Sekunden von „App offen" bis „gesendet". |
| D2 | Dieselbe Meldung nochmals absenden | Wird zusammengeführt, nicht dupliziert. |
| D3 | Meldung im Funkloch absenden (Tunnel) | „Gespeichert. Wird gesendet, sobald du wieder online bist." |
| D4 | Nach dem Tunnel warten | Meldung wird automatisch gesendet. |
| D5 | Meldung 35 Minuten im Funkloch liegen lassen | Wird **verworfen**, nicht verspätet gesendet. |
| D6 | Fremde Meldung bestätigen | Zähler steigt sofort (optimistisches Update). |
| D7 | Offizielle Störung anzeigen lassen | Trägt „Offizielle Meldung", optisch klar getrennt von Community-Meldungen. |
| D8 | Meldung melden (Missbrauch) | Landet in der Moderationsliste im Admin-Portal. |

---

## Teil E — Echtzeitdaten

| # | Prüfung | Erwartung |
| --- | --- | --- |
| E1 | Abfahrtstafel eines grossen Bahnhofs | Jede Zeile trägt LIVE, GESCHÄTZT oder FAHRPLAN. |
| E2 | Verspäteten Zug suchen | Verspätung stimmt mit der Anzeige am Bahnhof überein (±1 Minute). |
| E3 | Ausgefallene Fahrt suchen | Wird als „Fahrt fällt aus" gekennzeichnet. |
| E4 | Worker anhalten, 15 Minuten warten | Die App meldet ehrlich „Echtzeitdaten sind gerade nicht verfügbar". |
| E5 | Worker wieder starten | Nach spätestens 2 Minuten sind Live-Daten zurück. |

---

## Teil F — PWA-Verhalten unterwegs

| # | Prüfung | Erwartung |
| --- | --- | --- |
| F1 | App aus dem Home-Bildschirm starten | Vollbild, keine Browser-Adressleiste. |
| F2 | Im Zug den Bildschirm sperren, nach 5 Minuten entsperren | App zeigt weiterhin die Fahrt; Ortung läuft weiter, sobald die Seite sichtbar ist. |
| F3 | Flugmodus einschalten, App neu starten | App startet aus dem Cache, zeigt den Offline-Hinweis. |
| F4 | Neue Version ausrollen, während die App offen ist | „Eine neue Version ist verfügbar." erscheint; erst auf Knopfdruck wird neu geladen. |
| F5 | Push-Benachrichtigung antippen | Öffnet direkt die betroffene Fahrt bzw. Meldung. |
| F6 | Akkuverbrauch über eine Stunde Fahrt | Notieren. Richtwert: unter 10 % bei durchgehend geöffneter App. |

---

## Auswertung

Der Test gilt als bestanden, wenn:

- **Teil A und B:** mindestens 80 % der Fahrten korrekt erkannt oder korrekt abgefragt
  (eine Rückfrage zählt als Erfolg — Raten wäre schlechter).
- **Teil C:** **100 %.** Keine einzige Falsch-Erkennung. Kein Toleranzbereich.
- **Teil D und E:** alle Punkte erfüllt.
- **Teil F:** F1–F5 erfüllt; F6 nur dokumentiert.

Abweichungen bitte mit Ort, Uhrzeit, Linie und Screenshot festhalten. Jede reproduzierbare
Fehlerkennung sollte als neuer Fall in `scenarios.test.ts` landen — dann kann sie nicht
zurückkommen.
