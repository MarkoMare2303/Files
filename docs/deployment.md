# Betrieb und Deployment

## Komponenten

| Komponente | Laufzeit | Skalierung |
|------------|----------|------------|
| `apps/api` | Node 20+, zustandslos | horizontal |
| `apps/worker` | Node 20+, zustandsbehaftet | **genau eine Instanz** |
| `apps/web` | Next.js (Node) — **das ausgelieferte Produkt** | horizontal |
| `apps/admin` | Next.js (Node oder Edge) | horizontal |
| PostgreSQL + PostGIS | Supabase oder selbst betrieben | vertikal, Read Replicas möglich |
| Redis | optional | – |

**Der Worker darf nur einmal laufen.** Zwei Instanzen würden GTFS-RT doppelt
schreiben und Push-Nachrichten doppelt versenden. Bei Bedarf ist ein
Leader-Election-Mechanismus nachzurüsten.

## Voraussetzungen

- PostgreSQL 15+ **mit PostGIS 3.3+**. Ohne PostGIS starten die Migrationen nicht.
- Mindestens 25 GB Speicher für zwei GTFS-Feed-Versionen.
- Ausgehende HTTPS-Verbindungen zu `opentransportdata.swiss`, Supabase und
  `exp.host`.

## Reihenfolge beim ersten Deployment

```bash
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" run build
pnpm build

pnpm db:migrate      # Schema
pnpm db:seed         # Kategorien, Feature-Flags, Konfiguration
pnpm gtfs:import     # Fahrplandaten (10–25 Minuten)

# danach: API und Worker starten
```

Ohne GTFS-Import antwortet `/ready` mit 503 und `NO_ACTIVE_FEED` — das ist
korrekt: Ohne Fahrplandaten kann die App nichts Sinnvolles anzeigen.

### Erstes Administratorkonto

Es gibt bewusst keinen Weg, sich selbst zum Administrator zu machen. Nach der
Registrierung über das Admin-Portal:

```sql
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '<auth-user-id>';
```

Zusätzlich muss im Supabase-Konto ein zweiter Faktor (TOTP) eingerichtet sein —
ohne `aal2` verweigert das Portal den Zugriff.

## Konfiguration

Siehe `.env.example`. Zwingend in Produktion:

| Variable | Hinweis |
|----------|---------|
| `DATABASE_URL` | mit PostGIS |
| `API_INTERNAL_SECRET` | ≥ 32 Zeichen, zufällig; Platzhalter werden abgelehnt |
| `API_CORS_ORIGINS` | mindestens ein Origin |
| `SUPABASE_JWT_SECRET` oder `SUPABASE_URL` | für die Token-Prüfung |

Die Konfigurationsprüfung bricht beim Start mit einer verständlichen Meldung ab,
statt später mit `undefined` weiterzulaufen.

## Betriebsüberwachung

| Endpunkt | Bedeutung |
|----------|-----------|
| `GET /health` | Prozess lebt (Liveness) — antwortet immer schnell |
| `GET /ready` | Datenbank, Cache, Fahrplandaten, Feeds, Routenplaner (Readiness) |
| `GET /metrics` | Zähler und Latenz-Perzentile, nur für Administratoren |
| Worker `:3002/health` | Prozess lebt |
| Worker `:3002/ready` | Datenbank plus Zustand jedes Jobs |

`/ready` antwortet mit 503 nur, wenn Datenbank oder Fahrplandaten fehlen.
Fehlende Echtzeitdaten degradieren (`status: "degraded"`), blockieren aber
nicht — die App bleibt mit Fahrplanzeiten nutzbar.

### Was zu alarmieren ist

| Signal | Bedeutung |
|--------|-----------|
| `/ready` = 503 | Sofort — App unbrauchbar |
| `feed_health.consecutive_failures > 5` | Echtzeitdaten fallen aus |
| GTFS-Import > 48 h nicht erfolgreich | Fahrplan veraltet |
| `notification_queue` mit `status = 'PENDING'` wachsend | Push-Versand hängt |
| Spamquote steigend | Möglicher koordinierter Missbrauch |
| `abuse_signals` mit `severity = 'BLOCK'` häufen sich | Angriff |

## Datenbankpflege

Der Import erzeugt und löscht Millionen Zeilen. Autovacuum sollte für die
grossen Tabellen aggressiver eingestellt sein:

```sql
ALTER TABLE transit.stop_times SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE transit.trips SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE public.reports SET (autovacuum_vacuum_scale_factor = 0.05);
```

Backups müssen vor allem `public` erfassen — `transit` lässt sich jederzeit
durch einen Import wiederherstellen. Ein Restore ist regelmässig zu üben.

## Web-App (PWA) ausliefern

Die PWA ist eine gewöhnliche Next.js-Anwendung im Node-Modus. Sie braucht keinen
Store, keine Signierung und keine Zertifikate — nur HTTPS.

### Bauen und starten

```bash
# Die öffentlichen Werte müssen zur BAUZEIT gesetzt sein: Next.js ersetzt
# NEXT_PUBLIC_* durch Literale. Nachträgliches Setzen wirkt nicht.
export NEXT_PUBLIC_API_URL=https://api.example.ch
export NEXT_PUBLIC_SUPABASE_URL=https://<projekt>.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
export NEXT_PUBLIC_MAP_TILE_URL=https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json

pnpm install --frozen-lockfile
pnpm --filter "./packages/*" run build
pnpm --filter @swissov/web run build
pnpm --filter @swissov/web start          # Port 3002, per WEB_PORT änderbar
```

### HTTPS ist Pflicht

Service Worker, `navigator.geolocation` und die Push-API sind ausserhalb von
`localhost` an einen sicheren Kontext gebunden. Ohne gültiges Zertifikat ist die
App keine PWA, sondern eine gewöhnliche Website — sie lässt sich nicht
installieren, ortet nicht und empfängt keine Benachrichtigungen.

### Reverse Proxy

Zwei Regeln, alles andere ist Standard:

```nginx
# 1. Der Service Worker darf NIE aus einem Cache kommen — sonst bleibt eine
#    fehlerhafte Version dauerhaft aktiv.
location = /sw.js {
    proxy_pass http://127.0.0.1:3002;
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
}

# 2. Gehashte Build-Dateien dürfen dauerhaft gecacht werden.
location /_next/static/ {
    proxy_pass http://127.0.0.1:3002;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}

location / {
    proxy_pass http://127.0.0.1:3002;
}
```

Die App setzt ihre Sicherheits-Header selbst (`next.config.mjs`). Der Proxy soll
sie durchreichen und nicht überschreiben.

### CORS nicht vergessen

Der Browser ist jetzt ein CORS-Client — anders als die native App. Ohne diesen
Eintrag blockiert er jede API-Anfrage:

```bash
API_CORS_ORIGINS=https://app.example.ch
```

### Web Push einrichten

```bash
pnpm push:keys      # einmalig; Ausgabe in die Serverumgebung übernehmen
```

Der private Schlüssel gehört ausschliesslich in die Umgebung des **Workers**.
Ein Wechsel macht alle bestehenden Abos ungültig.

### Nach jedem Deployment

Offene Sitzungen erhalten den Hinweis „Eine neue Version ist verfügbar." und
laden erst auf Knopfdruck neu — ein automatischer Reload würde eine halb
geschriebene Meldung verwerfen. Wird der Service Worker inhaltlich geändert,
ist `VERSION` in `apps/web/public/sw.js` zu erhöhen, damit alte Caches
aufgeräumt werden.

## Native App (eingefroren)

`apps/mobile` wird derzeit **nicht** gebaut und **nicht** veröffentlicht. EAS,
TestFlight, App Store, Play Store, APNs-Zertifikate und Keystores sind damit
kein Bestandteil des Betriebs mehr. Das Verzeichnis bleibt als Referenz im
Repository, bis die PWA auf echten Geräten geprüft wurde (siehe
`MOBILE_TO_WEB_MIGRATION.md`).

## Aktualisierung des Fahrplans

Der Worker prüft nächtlich auf eine neue Version. Bei unveränderter Prüfsumme
passiert nichts. Bei einer neuen Version läuft der Import im Hintergrund; die
alte Version bleibt bis zum atomaren Umschalten aktiv.

Nach einem Feed-Wechsel können laufende Trip-Sessions auf `trip_id`s verweisen,
die es nicht mehr gibt. Der Trip-Screen zeigt dann eine verständliche Meldung
und bietet die Neuauswahl an.

## CI/CD

`.github/workflows/ci.yml` läuft bei jedem Pull Request in drei Jobs:

1. **quality** — Install, Build der Pakete, Lint, Typecheck, Unit-Tests, Build
2. **integration** — PostgreSQL/PostGIS als Service, Migrationen,
   Prüfsummenverifikation, Seeds, Integrationstests
3. **security** — `pnpm audit --audit-level high`, Secret-Scan, Prüfung auf
   eingecheckte `.env`

Ein Deployment darf erst nach erfolgreichen Tests erfolgen. Ein Deploy-Job ist
bewusst nicht enthalten — die Zielplattform ist nicht festgelegt.
