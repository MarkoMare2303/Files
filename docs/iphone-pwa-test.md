# PWA-Test auf dem iPhone

**Warum eine eigene Anleitung für iOS?** Weil Safari die restriktivste Umgebung ist, in
der diese App laufen muss. Was dort funktioniert, funktioniert überall. Umgekehrt gilt
das nicht: Ein grüner Test in Chrome auf Android sagt über iOS wenig aus.

**Voraussetzungen**
- iPhone mit **iOS 16.4 oder neuer** (darunter gibt es keine Web-Push-Unterstützung)
- Die App läuft unter **HTTPS mit gültigem Zertifikat** — `http://` und selbstsignierte
  Zertifikate reichen nicht: Service Worker, Standort und Push sind dann gesperrt
- Safari, nicht Chrome/Firefox auf iOS (dort gibt es kein „Zum Home-Bildschirm")

---

## 1. Was auf iOS anders ist

| Thema | Verhalten auf dem iPhone |
| --- | --- |
| Installation | Nur über Safari → Teilen → „Zum Home-Bildschirm". Kein automatischer Dialog, kein `beforeinstallprompt`. |
| Push | **Nur in der installierten App** (iOS ≥ 16.4). Im Safari-Tab existiert `window.PushManager` nicht. |
| Berechtigung für Push | Muss aus einer echten Nutzeraktion heraus angefordert werden — ein Tap, kein Timer. |
| Speicher | Wird nach 7 Tagen ohne Nutzung gelöscht (ITP) — **ausser** bei installierten PWAs. |
| Hintergrund | Keine Ortung, keine Hintergrundsynchronisation. Wird von der App auch nicht behauptet. |
| Vollbild | Braucht `apple-mobile-web-app-capable` (iOS < 17.4) bzw. `mobile-web-app-capable` (ab 17.4). Die App liefert beide. |
| Safe Area | Notch und Home-Indikator brauchen `viewport-fit=cover` plus `env(safe-area-inset-*)`. |
| Vibration | `navigator.vibrate` existiert auf iOS nicht. Die App prüft das und verzichtet still darauf. |

---

## 2. Installation

1. Safari öffnen, `https://<domain>` aufrufen.
2. Landing-Page prüfen: Überschrift, Quellenangabe, Schaltfläche „App öffnen".
3. „App öffnen" antippen → `/map`.
4. Nach kurzer Zeit erscheint unten die Einladung **„Auf dem iPhone installieren"** mit
   drei Schritten. Prüfen: Steht dort eine Anleitung und **keine** Schaltfläche
   „Installieren"? (Eine Schaltfläche wäre falsch — auf iOS kann sie nichts tun.)
5. Teilen-Symbol (Quadrat mit Pfeil nach oben) → **Zum Home-Bildschirm** → **Hinzufügen**.
6. Home-Bildschirm prüfen:
   - Das Icon zeigt das Fahrzeug-Symbol auf petrolblauem Grund (nicht ein Screenshot der
     Seite, nicht ein weisses Quadrat).
   - Der Name lautet **„ÖV Live"**.

**Wenn das Icon fehlt oder weiss ist:** `apple-touch-icon` prüfen —
`https://<domain>/icons/apple-touch-icon.png` muss ein 180×180-PNG liefern.

---

## 3. Start und Darstellung

| # | Prüfung | Erwartung |
| --- | --- | --- |
| 3.1 | App vom Home-Bildschirm starten | Vollbild, **keine** Safari-Adressleiste. |
| 3.2 | Statusleiste (Uhr, Akku) | Lesbar, nicht von Inhalten überdeckt. |
| 3.3 | Untere Navigationsleiste | Liegt **über** dem Home-Indikator, nicht darunter. |
| 3.4 | Gerät drehen | Layout bleibt benutzbar; Text wird nicht automatisch vergrössert. |
| 3.5 | Zwei Finger spreizen (Zoom) | Funktioniert. Eine App, die man nicht vergrössern kann, ist unzugänglich. |
| 3.6 | Einstellungen → Anzeige & Helligkeit → Dunkel | App wechselt in den Dunkelmodus, ohne Neustart. |
| 3.7 | Einstellungen → Bedienungshilfen → Grössere Schrift, Maximum | Nichts wird abgeschnitten. |
| 3.8 | Nach unten überziehen | Kein Gummiband-Effekt mit leerer Fläche dahinter. |
| 3.9 | Einstellungen → Bedienungshilfen → Bewegung reduzieren | Übergänge werden ruhig. |

---

## 4. Standort

| # | Prüfung | Erwartung |
| --- | --- | --- |
| 4.1 | App öffnen, ohne etwas anzutippen | **Kein** Standortdialog beim Start. |
| 4.2 | „Standort aktivieren" antippen | Erst jetzt erscheint der iOS-Dialog. |
| 4.3 | „Beim Verwenden der App erlauben" | Position erscheint auf der Karte. |
| 4.4 | Auf „Fahrten" wechseln | Der Hinweis „läuft nur, solange diese Seite geöffnet ist" ist sichtbar. |
| 4.5 | „Nicht erlauben" wählen (zweites Gerät oder Einstellungen zurücksetzen) | App bleibt vollständig bedienbar, erklärt die Einschränkung, bietet manuelle Fahrtauswahl an. |
| 4.6 | iOS-Einstellungen → Datenschutz → Ortungsdienste → Safari → Ort ändern | App übernimmt den neuen Status, ohne Neustart. |

---

## 5. Offline

| # | Prüfung | Erwartung |
| --- | --- | --- |
| 5.1 | App einmal vollständig laden, dann Flugmodus | App startet weiterhin (nicht die Safari-Fehlerseite). |
| 5.2 | Im Flugmodus navigieren | Oben steht der Offline-Hinweis. |
| 5.3 | Im Flugmodus eine Meldung absenden | „Gespeichert. Wird gesendet, sobald du wieder online bist." |
| 5.4 | Flugmodus aus, App wieder in den Vordergrund | Meldung wird automatisch gesendet, Hinweis verschwindet. |
| 5.5 | Im Flugmodus eine noch nie geöffnete Route aufrufen | Die Offline-Seite erscheint, kein Browser-Fehler. |

**Hinweis zu 5.4:** iOS-Safari feuert das `online`-Ereignis nicht immer zuverlässig.
Die App leert die Warteschlange deshalb zusätzlich bei `visibilitychange` — deswegen
muss man die App einmal in den Vordergrund holen.

---

## 6. Push-Benachrichtigungen

**Der wichtigste Test auf iOS — und der mit den meisten Fallstricken.**

### 6.1 Vorbedingung prüfen

| Situation | Erwartete Anzeige unter Einstellungen → Benachrichtigungen |
| --- | --- |
| App im **Safari-Tab** geöffnet (nicht installiert) | „Auf dem iPhone sind Benachrichtigungen erst möglich, wenn du die App zum Home-Bildschirm hinzugefügt hast." |
| App **installiert**, nicht angemeldet | „Melde dich an, um Benachrichtigungen zu erhalten." |
| App installiert, angemeldet, Server ohne VAPID | „Benachrichtigungen sind auf diesem Server nicht eingerichtet." |
| App installiert, angemeldet, Server eingerichtet | Schaltfläche „Benachrichtigungen aktivieren" |

**Es darf in keinem Fall ein Schalter erscheinen, der nichts bewirkt.**

### 6.2 Abo einrichten

1. Installierte App öffnen, anmelden.
2. Einstellungen → „Benachrichtigungen aktivieren" antippen.
3. iOS fragt nach der Erlaubnis → **Erlauben**.
4. Erwartung: „Benachrichtigungen sind aktiv."
5. Serverseitig prüfen:

```sql
SELECT endpoint, enabled, user_agent, created_at
FROM public.push_subscriptions
WHERE user_id = '<deine-user-id>';
```

Der Endpunkt beginnt bei iOS mit `https://web.push.apple.com/`.

### 6.3 Zustellung prüfen

```bash
# Testbenachrichtigung in die Outbox legen (nur auf einer Testinstanz!):
psql "$DATABASE_URL" -c "
  INSERT INTO public.notification_queue (user_id, title, body, data, scheduled_at, status)
  VALUES ('<deine-user-id>', 'Test', 'Zustellung funktioniert.',
          '{\"tripId\":\"<eine-echte-trip-id>\",\"serviceDate\":\"$(date +%F)\"}'::jsonb,
          now(), 'PENDING');
"
```

Der Worker holt sie beim nächsten Durchlauf (Standard: alle 20 Sekunden).

| # | Prüfung | Erwartung |
| --- | --- | --- |
| 6.3.1 | App im Vordergrund | Benachrichtigung erscheint. |
| 6.3.2 | App im Hintergrund | Benachrichtigung erscheint auf dem Sperrbildschirm. |
| 6.3.3 | Benachrichtigung antippen | Öffnet die App **direkt auf der Fahrt**, nicht auf der Startseite. |
| 6.3.4 | Zweite Benachrichtigung mit gleichem `tag` | Ersetzt die erste, statt sie zu stapeln. |
| 6.3.5 | Benachrichtigungen ausschalten und Datenbank prüfen | Zeile ist gelöscht, nicht nur deaktiviert. |

### 6.4 Wenn nichts ankommt

| Symptom | Ursache |
| --- | --- |
| Kein Erlaubnisdialog | App läuft im Safari-Tab, nicht installiert. |
| Dialog erscheint, aber kein Abo | iOS < 16.4, oder die Seite läuft nicht über HTTPS. |
| Abo vorhanden, aber nichts kommt an | Worker läuft nicht, oder `PUSH_ENABLED=false`. |
| Worker meldet HTTP 403 | VAPID-Schlüsselpaar passt nicht zu dem, mit dem sich der Browser angemeldet hat — nach einem Schlüsselwechsel müssen sich alle neu anmelden. |
| Worker meldet HTTP 410 | Abo abgelaufen; der Worker entfernt es selbst. Neu abonnieren. |

---

## 7. Update-Verhalten

| # | Prüfung | Erwartung |
| --- | --- | --- |
| 7.1 | Neue Version ausrollen, App danach öffnen | Oben: „Eine neue Version ist verfügbar." |
| 7.2 | Nichts antippen | App läuft normal weiter — **kein** automatisches Neuladen. |
| 7.3 | Meldung tippen, dann „Aktualisieren" antippen | Erst jetzt wird neu geladen. |
| 7.4 | Nach dem Neuladen | Neue Version aktiv, Hinweis verschwunden. |

**Warum kein automatisches Update:** Ein Reload mitten in einer halb geschriebenen
Meldung verwirft die Eingabe. Der Zeitpunkt gehört dem Nutzer.

---

## 8. Zurücksetzen für einen erneuten Test

1. App vom Home-Bildschirm löschen (gedrückt halten → „App entfernen").
2. Einstellungen → Safari → **Verlauf und Websitedaten löschen**.
3. Einstellungen → Safari → Erweitert → Website-Daten → Eintrag der Domain entfernen.
4. Serverseitig aufräumen:

```sql
DELETE FROM public.push_subscriptions WHERE user_id = '<deine-user-id>';
DELETE FROM public.devices           WHERE user_id = '<deine-user-id>';
```

---

## 9. Bekannte iOS-Eigenheiten (keine Fehler)

- **Kein Vibrieren beim Melden.** `navigator.vibrate` gibt es auf iOS nicht.
- **Kein Installations-Dialog.** `beforeinstallprompt` ist Chromium-spezifisch.
- **Kein Zurück-Wischen im Vollbild.** Systemverhalten installierter Web-Apps; die App
  bietet dafür eigene Zurück-Schaltflächen.
- **Standortabfrage bei jedem Kaltstart etwas langsam.** Safari verwirft den Cache der
  letzten Position aggressiver als Chrome.
- **Speicher wird nach 7 Tagen Nichtnutzung gelöscht** — betrifft nur den Safari-Tab,
  nicht die installierte App. Ein weiteres Argument für die Installation.
