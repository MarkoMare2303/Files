# Datenschutz-Architektur

> **Hinweis:** Dieses Dokument beschreibt die technische Umsetzung. Es ist
> **keine Rechtsberatung** und ersetzt keine Datenschutz-Folgenabschätzung.
> Abschnitte, die vor einem Launch juristisch geprüft werden müssen, sind mit
> **[JURISTISCH PRÜFEN]** markiert.

Die Anwendung richtet sich an Nutzer in der Schweiz und Europa. Massgeblich
sind das revidierte Schweizer DSG und die DSGVO.

## Grundhaltung

Standortdaten von Fahrgästen sind besonders heikel: Sie zeigen, wann jemand wo
unterwegs ist. Deshalb gilt: Es wird nur erhoben, was für die konkrete Funktion
nötig ist, und nur so lange aufbewahrt, wie es einen Zweck erfüllt.

## Welche Daten entstehen

| Daten | Zweck | Aufbewahrung |
|-------|-------|--------------|
| Auth-Konto (E-Mail bzw. Apple/Google-Kennung) | Anmeldung | bis zur Löschung |
| Pseudonym (`alias`) | Anzeige bei Meldungen | bis zur Löschung |
| Reputationswert | Trust Score, Missbrauchserkennung | bis zur Löschung |
| Meldung inkl. gerundeter Position | Kernfunktion | 90 Tage nach Ablauf |
| Fahrt-Sitzung (`trip_id`, Zeitraum) | Kontext für Meldungen | 30 Tage nach Ende |
| Letzte Position der Sitzung | Plausibilitätsprüfung | **bis Sitzungsende, dann gelöscht** |
| GPS-Punkte der Erkennung | Fahrtenerkennung | **nie gespeichert** |
| Gerät (Installations-ID, Plattform, Version) | Push, Missbrauchserkennung | 180 Tage ohne Nutzung |
| Push-Token | Benachrichtigungen | bis Abmeldung |
| Missbrauchssignale (gehashte IP) | Sicherheit | 180 Tage |
| Reputationsereignisse | Nachvollziehbarkeit | 365 Tage |
| Admin-Audit-Log | Revisionssicherheit | 730 Tage |

Die Werte stehen als `RETENTION` in `apps/worker/src/jobs/maintenance.job.ts`
und werden nächtlich durchgesetzt. **[JURISTISCH PRÜFEN]** — die Fristen sind
technisch begründet, nicht juristisch abgeleitet.

## Datenminimierung im Detail

### GPS-Punkte werden nicht gespeichert

`POST /v1/trip-detection` nimmt bis zu 10 Punkte entgegen, nutzt sie für die
Abfrage und verwirft sie. Sie landen weder in einer Tabelle noch im Log — Pino
redigiert `req.body.observations`.

### Positionen von Meldungen werden gerundet

`roundCoordinate()` rundet auf drei Nachkommastellen ≈ 110 Meter. Für die
Kartendarstellung reicht das; für ein Bewegungsprofil ist es zu grob.

### Keine Bewegungshistorie

`trip_sessions.last_position` hält **eine** Position für die
Plausibilitätsprüfung. Beim Beenden der Sitzung wird sie auf `NULL` gesetzt —
auch beim automatischen Beenden durch den Worker. Ein Integrationstest prüft
das.

### IP-Adressen nur als HMAC

Für Rate Limiting und Missbrauchserkennung genügt ein schlüsselgebundener Hash.
IPv6 wird zusätzlich auf das /64-Präfix gekürzt. Klartext-IPs werden nirgends
gespeichert. Ausnahme: `admin_audit_logs.ip` — für die Nachvollziehbarkeit
administrativer Zugriffe. **[JURISTISCH PRÜFEN]**

### Keine Hardware-Identifier

Die App erzeugt beim ersten Start eine zufällige Installations-ID. IDFA,
Android Advertising ID oder ähnliche Kennungen werden nicht verwendet.

## Einwilligungen

| Einwilligung | Standard | Wirkung |
|--------------|----------|---------|
| Standort (Vordergrund) | nicht erteilt | Ohne sie: keine automatische Erkennung, manuelle Auswahl bleibt |
| Standort (Hintergrund) | **aus** | Ohne sie: Ortung nur bei geöffneter App |
| Analytik | **aus** | Ohne sie: keine Produktmetriken |
| Push | nicht erteilt | Ohne sie: keine Benachrichtigungen |

Alle sind einzeln in den Einstellungen widerrufbar. Zeitpunkt der Erteilung
wird protokolliert (`*_consent_at`).

**Der Standortdialog erscheint nie ungefragt beim Start.** Das Onboarding
erklärt zuerst konkret, wofür der Standort gebraucht wird; erst danach folgt
der System-Dialog. „Später" ist eine gleichwertige Option.

## Betroffenenrechte

| Recht | Umsetzung |
|-------|-----------|
| Auskunft (DSGVO Art. 15 / DSG Art. 25) | `GET /v1/me/export` — vollständiger JSON-Export |
| Löschung (Art. 17 / Art. 32) | `DELETE /v1/me` — Konto und alle Inhalte |
| Berichtigung (Art. 16) | Einstellungen; Meldungen sind Momentaufnahmen und werden entfernt statt geändert |
| Datenübertragbarkeit (Art. 20) | Der Export ist maschinenlesbares JSON |
| Widerspruch (Art. 21) | Einwilligungen einzeln widerrufbar |

Die Löschung entfernt Profil, Einstellungen, Meldungen, Stimmen, Flags,
Sitzungen, Favoriten, Geräte, Push-Tokens, Reputationsereignisse und
Missbrauchssignale. Ist `SUPABASE_SERVICE_ROLE_KEY` gesetzt, wird auch das
Auth-Konto gelöscht; andernfalls meldet die API ehrlich zurück, dass dieser
Schritt separat erfolgen muss.

## Analytik

Geschlossene Ereignisliste ohne freie Attribute
(`packages/shared/src/analytics.ts`). Übertragen werden nur kategoriale Werte:
Fahrzeugtyp, Confidence-Band (`high`/`medium`/`low`), Erkennungsmethode,
Kategorie-Schlüssel. **Keine Koordinaten, keine Trip-IDs, keine Nutzer-IDs.**
Ohne Einwilligung ist der Adapter ein No-Op.

## Auftragsverarbeiter

| Dienst | Zweck | Ort |
|--------|-------|-----|
| Supabase | Auth, Datenbank, Realtime | Region wählbar — **EU-Region wählen** |
| opentransportdata.swiss | Fahrplandaten | Schweiz |
| Expo Push Service | Push-Zustellung | USA |
| Kartenanbieter | Kartenhintergrund | je nach Wahl |

**[JURISTISCH PRÜFEN]** Für jeden Dienst wird ein Auftragsverarbeitungsvertrag
benötigt. Beim Expo Push Service liegt eine Drittlandübermittlung vor —
Rechtsgrundlage und Garantien sind zu klären. Als Alternative kann direkt gegen
APNs/FCM zugestellt werden.

**[JURISTISCH PRÜFEN]** Der Kartenhintergrund lädt Tiles direkt vom Anbieter;
dabei wird dessen Server die IP-Adresse des Geräts bekannt. Die Vorgabe
(swisstopo) hält die Daten in der Schweiz.

## Besonders heikle Kategorien

Die Kategorien „medizinischer Notfall", „Sicherheitsereignis" und
„Polizei-/Rettungseinsatz" könnten Rückschlüsse auf Gesundheitsdaten oder
strafrechtliche Sachverhalte Dritter zulassen. Deshalb:

- Sie sind **vormoderationspflichtig** (`requires_moderation`) und erscheinen
  erst nach Prüfung.
- Ihre Beschreibung weist ausdrücklich darauf hin, keine Angaben zu Personen
  zu machen.
- Der Meldungstext ist auf 280 Zeichen begrenzt.

**[JURISTISCH PRÜFEN]** Ob diese Kategorien in dieser Form angeboten werden
sollen, ist eine rechtliche und redaktionelle Entscheidung.

## Offene Punkte vor dem Launch

- [ ] **[JURISTISCH PRÜFEN]** Datenschutzerklärung und Nutzungsbedingungen
- [ ] **[JURISTISCH PRÜFEN]** Datenschutz-Folgenabschätzung (DSGVO Art. 35) —
      Standortdaten in grossem Umfang legen eine nahe
- [ ] **[JURISTISCH PRÜFEN]** Verzeichnis von Verarbeitungstätigkeiten
- [ ] **[JURISTISCH PRÜFEN]** Auftragsverarbeitungsverträge
- [ ] **[JURISTISCH PRÜFEN]** Vertretung in der EU, falls erforderlich
- [ ] **[JURISTISCH PRÜFEN]** Aufbewahrungsfristen fachlich und rechtlich bestätigen
- [ ] **[JURISTISCH PRÜFEN]** Umgang mit Meldungen über Dritte (z. B. Kontrollen)
- [ ] Löschprozess bei Beschwerden dokumentieren
- [ ] Meldeprozess für Datenschutzverletzungen (72 Stunden) etablieren
