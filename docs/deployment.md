# Betrieb und Deployment

## Komponenten

| Komponente | Laufzeit | Skalierung |
|------------|----------|------------|
| `apps/api` | Node 20+, zustandslos | horizontal |
| `apps/worker` | Node 20+, zustandsbehaftet | **genau eine Instanz** |
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

## Mobile-App

Die App nutzt native Module (MapLibre, Location, Notifications) und läuft
deshalb **nicht in Expo Go**:

```bash
cd apps/mobile
pnpm exec expo prebuild        # native Projekte erzeugen
pnpm exec expo run:ios         # benötigt macOS + Xcode
pnpm exec expo run:android     # benötigt Android SDK
```

Für Store-Builds wird EAS verwendet. Erforderlich:

- **Apple**: Apple Developer Program (99 USD/Jahr), Bundle Identifier,
  Push-Zertifikat, Sign-in-with-Apple-Konfiguration
- **Google**: Play-Console-Konto (25 USD einmalig), Keystore, OAuth-Client-IDs

Diese Credentials sind nicht Teil des Repositories und müssen vom Betreiber
beschafft werden.

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
