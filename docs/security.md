# Sicherheit

## Grundsatz

Jede Berechtigung wird serverseitig geprüft. Angaben aus dem Client sind
Eingabedaten, keine Entscheidungsgrundlage. Konstrukte wie
`if (clientSaysIsAdmin)` existieren nirgends — die Rolle kommt ausschliesslich
aus `profiles.role`, nachgeschlagen anhand der verifizierten Token-Identität.

## Authentifizierung

Die App meldet sich bei Supabase Auth an (Apple, Google, E-Mail-Link) und
schickt das ausgestellte JWT als `Authorization: Bearer`. Die API prüft die
Signatur selbst:

- **HS256** gegen `SUPABASE_JWT_SECRET`
- **RS256/ES256/EdDSA** gegen den JWKS-Endpunkt von Supabase (gecacht)

Beide Varianten werden unterstützt, weil Supabase je nach Projektalter die eine
oder andere verwendet.

Ein ungültiges Token führt nicht sofort zu `401`: Es wird verworfen und die
Anfrage läuft im **Gastmodus** weiter. Lesen bleibt damit auch bei abgelaufenem
Token möglich; nur geschützte Routen lehnen ab. Das vermeidet, dass ein
abgelaufenes Token die App unbrauchbar macht.

## Autorisierung

| Ebene | Mechanismus |
|-------|-------------|
| Route | `requireAuth`, `requireModerator`, `requireAdmin` als `onRequest`-Hooks |
| Datensatz | Sichtbarkeitsprüfung im Service (`isVisibleTo`) |
| Datenbank | RLS-Policies für direkte Supabase-Zugriffe |

Admin-Routen prüfen zusätzlich im Portal: ohne `aal2` (zweiter Faktor) kein
Zugriff. Ein Admin-Bereich, der nur durch eine unbekannte URL geschützt ist,
ist kein Schutz.

## Eingabevalidierung

Jeder Endpunkt validiert Query, Params und Body mit Zod. Ungültige Eingaben
erreichen den Handler nie. Längen sind überall begrenzt:

| Feld | Grenze |
|------|--------|
| Meldungstext | 280 Zeichen |
| Freitext bei Missbrauchsmeldung | 500 Zeichen |
| GTFS-IDs | 255 Zeichen |
| GPS-Beobachtungen pro Anfrage | 10 |
| Request-Body | 128 KB |
| Request-Timeout | 30 s |

## SQL-Injection

Alle Queries sind parametrisiert (`$1`, `$2`, …). Dynamische Filter (z. B. in
der Admin-Meldungsliste) bauen nur die *Struktur* aus Code auf — Werte gehen
immer als Parameter.

Eine ESLint-Regel im Repository verbietet String-Konkatenation in
`.query()`-Aufrufen und hat während der Entwicklung bereits eine Stelle
gefunden.

Der `COPY`-basierte GTFS-Import escaped jeden Wert CSV-konform; die Werte
stammen ohnehin ausschliesslich aus der heruntergeladenen Datei.

## Missbrauchsschutz

Vollständig in `packages/shared/src/abuse.ts`, unit-getestet.

| Prüfung | Wirkung |
|---------|---------|
| Rate Limit pro Stunde/Tag | blockiert |
| Cooldown zwischen Meldungen | blockiert |
| Dublettenerkennung | verweist auf bestehende Meldung |
| Impossible Travel | blockiert |
| Position ausserhalb der Schweiz | blockiert |
| GPS-Plausibilität (Genauigkeit, Geschwindigkeit, Streckenabstand) | markiert |
| Spam-Muster (Streuung, Entfernungsquote, neues Konto) | blockiert oder markiert |

Der Beispielfall aus der Spezifikation — 20 Meldungen in 20 Städten innerhalb
von 30 Sekunden — wird von der Impossible-Travel-Prüfung erfasst: über
350 km/h zwischen zwei Meldungen ist physikalisch ausgeschlossen. Ein
Integrationstest belegt das mit Zürich → Genf in 30 Sekunden.

Alle Befunde landen in `abuse_signals` (mit gehashter IP, nie im Klartext) und
sind im Admin-Portal auswertbar.

**Dublettenprüfung läuft vor den Rate Limits.** Meldet jemand dasselbe erneut,
ist der Hinweis auf die bestehende Meldung hilfreicher als eine
Cooldown-Fehlermeldung.

## Rate Limiting

Zwei Ebenen:

1. **Transport** (`@fastify/rate-limit`): global pro Minute, verschärft auf
   schreibenden Routen. Schlüssel ist die Nutzer-ID, im Gastmodus die gehashte
   IP.
2. **Fachlich** (Datenbankzähler): Meldungen pro Stunde/Tag, Stimmen pro
   Stunde, Missbrauchsmeldungen pro Tag. Diese Zähler überstehen Neustarts und
   sind im Admin-Portal konfigurierbar.

## Transport und Header

Die API setzt via Helmet: `Content-Security-Policy` (`default-src 'none'` in
Produktion), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, HSTS.

CORS ist auf `API_CORS_ORIGINS` beschränkt; in Produktion erzwingt die
Konfigurationsprüfung mindestens einen Eintrag. Eine leere Liste bedeutet
„kein Browser-Origin erlaubt" — die Mobile-App ist kein Browser-Client und von
CORS nicht betroffen.

Das Admin-Portal setzt zusätzlich eine enge CSP, die `connect-src` auf die
eigene API und Supabase begrenzt.

## Admin-Portal

| Massnahme | Umsetzung |
|-----------|-----------|
| Getrennte Rolle | `profiles.role` = `ADMIN` bzw. `MODERATOR` |
| MFA-Pflicht | Zugriff nur mit `aal2` |
| Serverseitige Autorisierung | Alle Aktionen laufen über die API, nie direkt auf die DB |
| Sitzungs-Timeout | Inaktivität > `ADMIN_SESSION_TIMEOUT_MINUTES` beendet die Sitzung |
| Sichere Cookies | `httpOnly`, `sameSite=lax`, `secure` in Produktion |
| CSRF | Server Actions mit Origin-Prüfung; Abmeldung nur per POST |
| Audit-Log | Jede verändernde Aktion, append-only |

## Secrets

- Serverseitige Schlüssel (`SUPABASE_SERVICE_ROLE_KEY`,
  `OPENTRANSPORTDATA_*_API_KEY`, `OJP_API_KEY`) sind der App **nie** bekannt.
- Nur `EXPO_PUBLIC_*` landet im App-Bundle — dort ausschliesslich die API-URL,
  die Supabase-URL, der Anon-Key und die Karten-Style-URL.
- `.env` ist in `.gitignore`; ein CI-Schritt (`scripts/check-secrets.mjs`)
  prüft jeden Commit auf JWT-artige Schlüssel, AWS-IDs, private Keys, GitHub-
  und Google-Tokens sowie Datenbank-URLs mit echten Passwörtern.

## Logging

Pino redigiert `authorization`, `cookie`, `x-install-id` sowie Koordinaten aus
Request-Bodies. Der Error-Tracker entfernt zusätzlich alle Felder mit
sensiblen Namen (Token, Secret, E-Mail, lat/lon). Stacktraces bleiben
serverseitig; nach aussen geht ausschliesslich Code, Text und Request-ID.

## Was vor dem Launch zu tun ist

- [ ] Penetrationstest durch Dritte
- [ ] Abhängigkeits-Scanning im laufenden Betrieb (Dependabot/Renovate)
- [ ] WAF bzw. DDoS-Schutz vor der API
- [ ] Rotationsplan für alle Schlüssel
- [ ] Alarmierung bei Auffälligkeiten in `abuse_signals`
- [ ] Backup- und Wiederherstellungsübung
