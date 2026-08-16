# Sicherheitsaudit — Schweizer ÖV Live (PWA)

**Datum:** 2026-08-16
**Umfang:** `apps/web` (PWA), `apps/api`, `apps/worker`, `packages/*`, Datenmodell, Auslieferung
**Methode:** Quellcode-Durchsicht, automatisierte Prüfungen (`pnpm lint`, Secret-Scan,
Integrationstests gegen echte PostGIS-Datenbank, Playwright gegen den Produktions-Build)
**Nicht enthalten:** Penetrationstest gegen eine laufende Produktionsinstanz, Prüfung der
Supabase-Konfiguration des Betreibers, Prüfung der Infrastruktur (TLS-Terminierung, WAF, DDoS)

---

## Zusammenfassung

| Schweregrad | Gefunden | Behoben | Offen |
| --- | --- | --- | --- |
| Kritisch | 0 | 0 | 0 |
| Hoch | 2 | 2 | 0 |
| Mittel | 4 | 3 | 1 |
| Niedrig | 5 | 3 | 2 |
| Hinweis | 3 | — | 3 |

**Alle Findings mit Schweregrad Kritisch und Hoch sind behoben.**
Die verbleibenden offenen Punkte sind bewusste, dokumentierte Abwägungen bzw. Aufgaben,
die erst mit einer konkreten Betriebsumgebung entschieden werden können.

---

## Behobene Findings

### WEB-001 · Hoch · Fahrten ohne Zeitbezug wurden zugeordnet

**Bereich:** `packages/shared/src/detection/scoring.ts`

**Beschreibung:** Die Zeitkomponente ging mit 25 % Gewicht additiv in die Bewertung ein.
Wer auf einer Bahnlinie stand, sammelte aus Streckennähe (30 %), Richtung (15 %) und
Geschwindigkeit (10 %) genug Punkte, um die Bestätigungsschwelle von 0.70 zu überschreiten —
auch wenn der Zug eine Stunde zuvor angekommen war.

**Angriffsszenario:** Kein Angriff von aussen nötig — ein Fehlverhalten der Anwendung.
Die Folge ist aber sicherheitsrelevant für die Datenqualität: Meldungen (inklusive
Kontrollmeldungen) hätten Fahrten zugeordnet werden können, die gar nicht verkehren.
Wer das gezielt ausnutzen will, meldet vom Bahnsteig aus beliebige Fahrten des ganzen Tages.

**Nachweis:** `packages/shared/src/detection/scenarios.test.ts` →
„Beobachtung eine Stunde nach Ankunft ergibt keine Zuordnung" (ergab 0.704).

**Behebung:** Zeitliches Ausschlusskriterium als MULTIPLIKATIVER Faktor
(`scheduleWindowFactor`): innerhalb des Fahrtfensters plus Karenz gilt 1, danach fällt der
Faktor über 20 Minuten auf 0.15. Eine Fahrt, die nicht verkehrt, kann damit die
Auto-Schwelle nicht mehr erreichen.

**Status:** ✅ behoben, durch Test abgesichert

---

### WEB-002 · Hoch · Als ausgefallen gemeldete Fahrten wurden automatisch übernommen

**Bereich:** `packages/shared/src/detection/scoring.ts`

**Beschreibung:** Meldet der Betrieb eine Fahrt per GTFS-RT als ausgefallen, senkte das
lediglich den Echtzeit-Teilscore (10 % Gewicht) von 0.6 auf 0.02 — ein Abzug von rund
0.058. Eine geometrisch perfekt passende Fahrt erreichte damit weiterhin exakt 0.900 und
wurde stillschweigend übernommen.

**Angriffsszenario:** Ein Nutzer wird einer ausgefallenen Fahrt zugeordnet und meldet
darauf. Andere Fahrgäste sehen Meldungen zu einem Zug, der nicht fährt — die
Glaubwürdigkeit der gesamten Community-Ebene leidet.

**Nachweis:** `scenarios.test.ts` → „Eine als ausgefallen gemeldete Fahrt wird nicht
automatisch übernommen" (ergab exakt 0.900 bei einer Schwelle von 0.90).

**Behebung:** `CANCELLED_CONFIDENCE_CAP = 0.85` — eine als ausgefallen gemeldete Fahrt
bleibt wählbar (Ersatzverkehr und kurzfristig doch verkehrende Züge gibt es), wird aber
nie ohne Rückfrage übernommen.

**Status:** ✅ behoben, durch Test abgesichert

---

### WEB-003 · Mittel · Warnfarbe war als Text unlesbar

**Bereich:** `packages/ui/src/tokens.ts`

**Beschreibung:** `lightTheme.warning` war `#E0A32E`. Als Textfarbe erreichte das
2.22:1 auf weissem Grund und 1.96:1 auf der zugehörigen Fläche `warningSubtle` — weit
unter WCAG AA (4.5:1). Betroffen waren Verspätungshinweise und alle Datenhinweise
(`DataNotice`), also genau die Stellen, an denen die App Einschränkungen kommuniziert.

**Angriffsszenario:** Kein Angriff, aber ein Sicherheitsproblem im weiteren Sinn: Wer die
Warnung „Echtzeitdaten sind gerade nicht verfügbar" nicht lesen kann, hält Fahrplanzeiten
für Live-Zeiten. Für Menschen mit eingeschränktem Sehvermögen ist die Angabe unsichtbar.

**Nachweis:** `apps/web/src/components/source-badge.test.ts` → „Statusfarben sind auf
ihrer eigenen Fläche lesbar".

**Behebung:** `palette.warning[700]` von `#9B6F17` auf `#8A6314` angepasst (der 700er-Schritt
war deutlich heller als die 700er-Schritte von `success`/`danger`) und `lightTheme.warning`
auf diesen Schritt umgestellt: 5.4:1 auf Weiss, 4.8:1 auf `warningSubtle`.

**Status:** ✅ behoben, durch Kontrasttest in beiden Themes abgesichert

---

### WEB-004 · Mittel · Push-Abos konnten von Fremden abgemeldet werden

**Bereich:** `apps/api/src/routes/me.ts`

**Beschreibung:** Beim Entwurf des Endpunkts `DELETE /v1/me/push-subscriptions` wäre eine
Löschung allein anhand des Endpunkts naheliegend gewesen. Der Endpunkt ist zwar schwer zu
erraten, aber kein Geheimnis — er wird an den Push-Dienst des Browsers übertragen und ist
in Netzwerk-Logs sichtbar.

**Angriffsszenario:** Wer den Endpunkt eines anderen Nutzers kennt, meldet dessen
Benachrichtigungen ab. Das ist keine Datenpreisgabe, aber ein Denial-of-Service gegen die
Sicherheitsfunktion „Benachrichtigung bei Störung".

**Behebung:** Die Löschung ist auf `endpoint = $1 AND user_id = $2` eingeschränkt.

**Nachweis:** `apps/api/src/api.integration.test.ts` → „verhindert das Abmelden fremder Abos".

**Status:** ✅ behoben, durch Integrationstest abgesichert

---

### WEB-005 · Mittel · API-Antworten hätten im Browser-Cache landen können

**Bereich:** `apps/web/src/api/client.ts`

**Beschreibung:** `fetch` ohne explizite Cache-Direktive folgt den Headern des Servers.
Käme eine Zwischeninstanz (Reverse Proxy, Firmen-Proxy, Browser-Cache) auf die Idee, eine
Antwort auf `/v1/me` zwischenzuspeichern, könnte auf einem geteilten Gerät die nächste
Person fremde Profildaten sehen.

**Angriffsszenario:** Gemeinsam genutztes Familientablet oder Gerät in einer
Bildungseinrichtung: Nutzer A meldet sich ab, Nutzer B öffnet dieselbe Seite und erhält
die zwischengespeicherte Antwort.

**Behebung:** Alle Anfragen laufen mit `cache: 'no-store'` und `credentials: 'omit'`
(die Authentifizierung erfolgt über den `Authorization`-Header, nicht über Cookies).
Zusätzlich schliesst der Service Worker `/v1/*` und alle Fremd-Ursprünge vom Caching aus.

**Nachweis:** `apps/web/src/api/client.test.ts` → „cacht Antworten nicht — sie sind
nutzerbezogen".

**Status:** ✅ behoben, durch Test abgesichert

---

### WEB-006 · Niedrig · Service Worker hätte sich selbst aussperren können

**Bereich:** `apps/web/next.config.mjs`, `apps/web/public/sw.js`

**Beschreibung:** Wird `/sw.js` mit einer Caching-Direktive ausgeliefert, bleibt eine
fehlerhafte Version des Workers dauerhaft aktiv — sie kontrolliert dann selbst, was
nachgeladen wird. Ein Fehler in der Auslieferung wäre praktisch nicht mehr korrigierbar,
ohne dass jeder Nutzer seinen Browser-Speicher leert.

**Behebung:** `/sw.js` wird mit `Cache-Control: no-cache, no-store, must-revalidate`
ausgeliefert. Der Cache-Name ist versioniert (`swissov-static-v1`), alte Caches werden
beim `activate` gelöscht.

**Nachweis:** `apps/web/e2e/app.spec.ts` → „der Service Worker selbst wird nie aus dem
Cache ausgeliefert".

**Status:** ✅ behoben, durch E2E-Test abgesichert

---

### WEB-007 · Niedrig · Referrer hätte Fahrt- und Meldungs-IDs nach aussen getragen

**Bereich:** `apps/web/next.config.mjs`

**Beschreibung:** Die App-Routen enthalten identifizierende Angaben im Pfad
(`/trip/<gtfs-id>`, `/reports/<uuid>`). Mit der Standard-Referrer-Politik landen diese
Pfade im `Referer`-Header jeder ausgehenden Anfrage — auch beim Laden von Kartenkacheln
bei einem Drittanbieter.

**Behebung:** `Referrer-Policy: strict-origin-when-cross-origin`. Fremde Hosts sehen nur
noch den Ursprung, nie den Pfad.

**Nachweis:** `apps/web/e2e/app.spec.ts` → „die Sicherheits-Header sind gesetzt".

**Status:** ✅ behoben

---

### WEB-008 · Niedrig · Standort-Berechtigung war global freigegeben

**Bereich:** `apps/web/next.config.mjs`

**Beschreibung:** Ohne `Permissions-Policy` dürfen eingebettete Inhalte dieselben
Berechtigungen anfordern wie die Seite selbst.

**Behebung:** `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()`.
Zusätzlich verbietet die CSP mit `frame-ancestors 'none'` und `X-Frame-Options: DENY` das
Einbetten der App überhaupt.

**Status:** ✅ behoben

---

## Offene Punkte

### WEB-009 · Mittel · Refresh-Token liegt in `localStorage`

**Bereich:** `apps/web/src/auth/supabase.ts`

**Beschreibung:** Der Supabase-Client speichert die Sitzung in `localStorage`. Anders als
in der nativen App (Secure Store) ist dieser Speicher für JavaScript im selben Ursprung
lesbar. Gelingt eine XSS-Einschleusung, ist die Sitzung übernommen.

**Warum trotzdem so:** Die Alternative — ein `HttpOnly`-Cookie — erfordert einen eigenen
serverseitigen Auth-Proxy vor Supabase. Das ist möglich, verlagert aber die
Sitzungsverwaltung aus einer geprüften Bibliothek in eigenen Code und bringt CSRF als
neues Problem mit.

**Kompensierende Massnahmen (alle umgesetzt):**
- Strikte CSP ohne fremde Skript-Hosts; `connect-src` nur eigene API, Supabase, Kartenhost.
- Keine Verwendung von `dangerouslySetInnerHTML` oder `innerHTML` im gesamten Frontend
  (verifiziert per Suche).
- Keine Fremdskripte, kein Werbe- oder Tracking-SDK.
- Das Zugriffstoken wird nicht zusätzlich in den App-Speicher geschrieben
  (`session.store.ts`, `partialize` — durch Test abgesichert).
- Alle Berechtigungen werden serverseitig geprüft; ein übernommenes Token verschafft nur
  die Rechte des betroffenen Kontos, nie Adminrechte.

**Empfehlung:** Vor dem öffentlichen Start entscheiden, ob ein Auth-Proxy mit
`HttpOnly`-Cookies gebaut wird. Bis dahin ist das Risiko bekannt und begrenzt.

**Status:** 🟡 bewusste Abwägung, dokumentiert

---

### WEB-010 · Niedrig · CSP erlaubt `'unsafe-inline'` und `'unsafe-eval'` für Skripte

**Bereich:** `apps/web/next.config.mjs`

**Beschreibung:** Next.js gibt für die Hydration Inline-Skripte aus; MapLibre erzeugt
seine Worker aus Blob-URLs und benötigt `'unsafe-eval'` für den WebGL-Shader-Aufbau.
Beides schwächt den XSS-Schutz der CSP.

**Warum derzeit so:** Eine Nonce-basierte CSP erfordert in Next.js eine Middleware, die
jede Antwort dynamisch macht — damit entfällt die statische Auslieferung der Seiten und
der Betrieb wird spürbar teurer. Der Nutzen wäre begrenzt, solange `'unsafe-eval'` für die
Karte ohnehin nötig ist.

**Empfehlung:** Zusammen mit WEB-009 neu bewerten. Wird ein Auth-Proxy gebaut, läuft
ohnehin eine Middleware — dann ist die Nonce-CSP fast kostenlos.

**Status:** 🟡 bewusste Abwägung, dokumentiert

---

### WEB-011 · Niedrig · Kein Rate Limit für den Abruf statischer Seiten

**Bereich:** Auslieferung der PWA

**Beschreibung:** Die API begrenzt Anfragen pro Konto bzw. pro pseudonymisierter IP
(`RATE_LIMIT_GLOBAL_PER_MINUTE`). Die Auslieferung der Seiten selbst tut das nicht.

**Warum das hier richtig ist:** Ein Rate Limit auf statische Assets gehört auf die Ebene
davor — CDN oder Reverse Proxy. Es in der Anwendung zu implementieren, würde die
Auslieferung verlangsamen und wäre bei mehreren Instanzen ohnehin wirkungslos.

**Empfehlung:** In der Betriebsumgebung konfigurieren (Cloudflare, nginx `limit_req`,
o. Ä.). Siehe `PRODUCTION_READINESS.md`.

**Status:** 🟡 Infrastrukturaufgabe

---

## Hinweise ohne Handlungsbedarf

### HINWEIS-1 · Der öffentliche VAPID-Schlüssel wird ausgeliefert

`GET /v1/app-config` gibt `webPush.publicKey` zurück. Das ist beabsichtigt und nach
RFC 8292 vorgesehen: Der Browser braucht ihn für `PushManager.subscribe()`. Der private
Schlüssel existiert ausschliesslich als Umgebungsvariable im Worker-Prozess und ist weder
in der Datenbank noch in einer `NEXT_PUBLIC_*`-Variable abgelegt. Ein Integrationstest
prüft, dass die Antwort keinen privaten Schlüssel enthält, ein E2E-Test prüft das
ausgelieferte JavaScript-Bundle auf verbotene Muster.

### HINWEIS-2 · `p256dh` und `auth` in der Datenbank sind keine Serverschlüssel

Beide gehören zum Browser des Nutzers und dienen der Ende-zu-Ende-Verschlüsselung der
Push-Nutzlast (RFC 8291). Ohne sie könnte der Push-Dienst des Herstellers den Inhalt
mitlesen. Sie in der Datenbank zu speichern ist der vorgesehene Weg; die Spalten sind
entsprechend kommentiert (Migration `0010_web_push.sql`).

### HINWEIS-3 · Keine Hintergrundortung — technisch und bewusst

Browser bieten keine Ortung im Hintergrund. Die App simuliert das nicht, sondern beendet
die Ortung bei `visibilitychange` und sagt in Onboarding, Fahrtenansicht und Einstellungen
klar, dass die Erkennung nur bei geöffneter Seite läuft. Damit entfällt auch die
Datenschutzfrage nach heimlicher Standorterfassung.

---

## Geprüfte Bereiche ohne Befund

| Bereich | Prüfung | Ergebnis |
| --- | --- | --- |
| SQL-Injection | Alle Queries parametrisiert; ESLint-Regel verbietet String-Konkatenation in `.query()` | ohne Befund |
| Berechtigungsprüfung | Kein `if (clientSaysIsAdmin)`; Rolle stammt aus dem serverseitig geladenen Profil | ohne Befund |
| Row Level Security | Auf allen `public`-Tabellen aktiv; für `reports`/`report_votes`/`report_flags` bewusst OHNE INSERT/UPDATE-Policy, damit Schreibzugriffe zwingend über die API laufen | ohne Befund |
| Secrets im Repository | `node scripts/check-secrets.mjs` — 212 Dateien | ohne Befund |
| Secrets im Browser-Bundle | E2E-Test sucht in allen `_next/static/*.js` nach `SERVICE_ROLE`, `VAPID_PRIVATE`, `JWT_SECRET`, `API_INTERNAL_SECRET`, `OPENTRANSPORTDATA_API_KEY` | ohne Befund |
| XSS über Meldungstexte | Kein `dangerouslySetInnerHTML`, kein `innerHTML`; React escapt alle Textinhalte | ohne Befund |
| Log-Hygiene | Fastify redigiert `authorization`, `cookie`, `x-install-id`, `req.body.observations`, `lat`, `lon` | ohne Befund |
| IP-Adressen | Werden vor jeder Weiterverwendung mit `API_INTERNAL_SECRET` gehasht | ohne Befund |
| Positionsdaten | Auf ~100 m gerundet gespeichert; keine Bewegungshistorie; Beobachtungen werden nicht persistiert | ohne Befund |
| Offene Weiterleitungen | `/auth/callback` leitet ausschliesslich auf `/map` weiter, nie auf eine Ziel-URL aus dem Parameter | ohne Befund |
| Push-Deep-Links | `notificationclick` öffnet nur relative Pfade aus einer serverseitig gebauten Liste | ohne Befund |
| Upload-Grössen | `bodyLimit: 128 KB`, `requestTimeout: 30 s` | ohne Befund |
| Abhängigkeiten | Keine Pakete mit bekannten kritischen Schwachstellen zum Prüfzeitpunkt | ohne Befund |

---

## Nachprüfen

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
node scripts/check-secrets.mjs
pnpm --filter @swissov/api run test:integration     # braucht PostGIS
pnpm --filter @swissov/web run test:e2e             # braucht Playwright-Browser
```
