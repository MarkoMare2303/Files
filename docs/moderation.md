# Moderation

## Ziel

Community-Meldungen sind nur dann nützlich, wenn ihnen vertraut werden kann.
Gleichzeitig darf Moderation nicht zum Flaschenhals werden — die meisten
Meldungen sind harmlos und leben ohnehin nur 20 Minuten.

Deshalb arbeitet das System dreistufig: automatische Prüfung beim Erstellen,
Community-Korrektur durch Abstimmung, menschliche Moderation nur bei Bedarf.

## Stufe 1 — Beim Erstellen

Vor dem Speichern prüft die API (`ReportsService.create`):

1. **Idempotenz**: Bekannte `clientReportId` → bestehende Meldung zurückgeben.
2. **Dubletten**: Gleiche Kategorie, gleicher Bezug, gleicher Nutzer im
   Zeitfenster → Verweis auf die bestehende Meldung statt Fehler.
3. **Rate Limits und Cooldown**.
4. **Spam-Muster**: Streuung über viele Orte, hohe Entfernungsquote, Burst von
   einem neuen Konto.
5. **GPS-Plausibilität**: Genauigkeit, Geschwindigkeit passend zum Fahrzeugtyp,
   Abstand zur gemeldeten Strecke, Position innerhalb der Schweiz.
6. **Impossible Travel**: Vergleich mit der letzten Meldung desselben Nutzers.

Ergebnis:

| Situation | Status der Meldung |
|-----------|--------------------|
| Alles unauffällig | `ACTIVE` |
| Kategorie ist vormoderationspflichtig | `PENDING_REVIEW` |
| Reputation unter Schwelle | `PENDING_REVIEW` |
| Plausibilitätsmarkierungen vorhanden | `PENDING_REVIEW` |
| Konto shadow-geflaggt | `SHADOWED` |
| Blockierender Befund | abgelehnt (HTTP 422) |

## Stufe 2 — Community

**Abstimmung** (§18): „Trifft zu" / „Nicht mehr aktuell". Eine Stimme pro
Nutzer und Meldung (Unique Constraint `report_id + user_id`), erneutes
Abstimmen ersetzt die vorherige. Eigene Meldungen kann niemand bewerten.

**Automatisches Ende**: Erreichen die Gegenstimmen bei mindestens 4 Stimmen
einen Anteil von 70 %, endet die Meldung sofort. Beide Werte sind im
Admin-Portal konfigurierbar.

**Trust Score** (0–100) fliesst aus: Bestätigungen und Gegenstimmen (logarithmisch
gesättigt), Alter (Halbwertszeit 45 Minuten), Reputation des Melders, ob eine
Fahrt-Sitzung nachgewiesen war, GPS-Plausibilität, Missbrauchsmeldungen,
Meldungsfrequenz.

```text
0–30    geringe Sicherheit
31–69   wahrscheinlich
70–100  mehrfach bestätigt
```

**Missbrauchsmeldungen**: Ab 3 Meldungen (konfigurierbar) wandert der Beitrag
automatisch nach `PENDING_REVIEW` und ist für Aussenstehende sofort unsichtbar —
der Autor sieht ihn weiterhin.

## Stufe 3 — Menschliche Moderation

Im Admin-Portal unter **Meldungen**, filterbar nach Datum, Kategorie, Betreiber,
Linie, Nutzer, Status, Trust Score und „nur gemeldete".

| Aktion | Wirkung |
|--------|---------|
| Freigeben | `PENDING_REVIEW` → `ACTIVE`, offene Flags erledigt |
| Entfernen | → `REMOVED`, Reputation −15, Entfernungszähler +1 |
| Wiederherstellen | → `ACTIVE` |

Jede Aktion verlangt eine Begründung (mindestens 3 Zeichen) und landet sowohl
in `moderation_actions` als auch im append-only `admin_audit_logs`.

### Nutzermassnahmen

| Aktion | Wirkung |
|--------|---------|
| Verwarnen | Nur protokolliert |
| Shadow-Flag | Neue Meldungen erhalten `SHADOWED` — nur der Autor sieht sie |
| Sperren | Kein Erstellen und Bewerten; optional befristet |
| Entsperren | Zurück zu `ACTIVE` |

Administratorkonten lassen sich über die Moderation nicht sperren.

**Warum Shadow-Flagging?** Wer merkt, dass er blockiert ist, legt ein neues
Konto an. Wer es nicht merkt, hört meist von selbst auf. Die Massnahme ist
deshalb bewusst unauffällig: Der Autor sieht seine Meldungen wie gewohnt, seine
Profil-Anzeige zeigt `ACTIVE`.

## Reputation

Interner Wert von −100 bis +100, **nie öffentlich sichtbar**. Ein öffentlicher
Punktestand würde zu Wettbewerb und damit zu mehr Falschmeldungen führen.

| Ereignis | Δ |
|----------|---|
| Meldung bestätigt | +3 |
| Meldung widersprochen | −2 |
| Meldung mit nachgewiesener Fahrt | +1 |
| Stimme entsprach dem Konsens | +1 |
| Meldung moderativ entfernt | −15 |
| Dublette | −3 |
| Unplausibler Standort | −10 |
| Spam erkannt | −25 |

Der Nutzer sieht nur eine grobe Stufe (`NEW`, `ESTABLISHED`, `TRUSTED`), die
sowohl Punkte als auch Kontoalter und bestätigte Meldungen berücksichtigt — ein
frisches Konto kann sich nicht durch Masse hochstufen.

## Kategorien pflegen

Unter **Kategorien** lassen sich TTL, Icon, Farbe, Standard-Scope,
Vormoderationspflicht und Aktivstatus ändern. Neue Kategorien erscheinen ohne
App-Update, weil die App das Melden-Sheet vollständig aus
`GET /v1/app-config` rendert.

Eine deaktivierte Kategorie verschwindet aus der Auswahl; bestehende Meldungen
bleiben sichtbar, bis sie ablaufen.

## Eskalation

Sicherheitsrelevante Kategorien („Sicherheitsereignis", „medizinischer
Notfall", „Polizei-/Rettungseinsatz") sind vormoderationspflichtig und
erreichen die Öffentlichkeit erst nach Prüfung.

**Diese App ist kein Notrufkanal.** Die Kategoriebeschreibung weist ausdrücklich
darauf hin, bei akuter Gefahr 112 zu wählen.

## Kennzahlen

Das Dashboard zeigt: Meldungen heute/aktiv/7 Tage, offene Moderationsfälle,
Spamquote (Anteil entfernter Meldungen der letzten 7 Tage), Verteilung nach
Kategorie, gesperrte und shadow-geflaggte Konten.

Eine steigende Spamquote bei gleichzeitig sinkendem Trust-Durchschnitt ist das
klarste Frühwarnsignal für koordinierten Missbrauch.
