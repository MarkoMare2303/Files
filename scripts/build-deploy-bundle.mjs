#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Baut ein selbsttragendes Auslieferungsbündel.
 *
 *     node scripts/build-deploy-bundle.mjs [--out dist-deploy] [--skip-build]
 *
 * Ergebnis ist ein Verzeichnis, das ohne pnpm, ohne Workspace und ohne
 * `npm install` läuft — nur Node.js 20+ auf dem Zielserver.
 *
 * Warum es dieses Skript braucht: Dieses Repository ist ein pnpm-Workspace. Die
 * Anwendungen verweisen mit `workspace:*` auf interne Pakete, die in keiner
 * Registry liegen. Kopiert man einen App-Ordner auf einen Webserver und lässt
 * dort `npm install` laufen, scheitert es genau daran. Das Skript löst die
 * Verweise auf:
 *
 *   • `pnpm deploy --legacy --prod` für API und Worker — schreibt die internen
 *     Pakete als echte Verzeichnisse in `node_modules`.
 *   • `output: 'standalone'` für die beiden Next.js-Apps — dazu die statischen
 *     Dateien, die Next bewusst NICHT mitkopiert.
 *
 * Was das Skript NICHT kann: Fahrplandaten beschaffen (das braucht Netzzugang
 * und einen Import auf dem Zielserver) und die rechtlichen Texte schreiben.
 * Beides steht in der erzeugten README.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

const outDir = resolve(root, arg('--out', 'dist-deploy'));
const skipBuild = process.argv.includes('--skip-build');

/**
 * Legt eine ausgefüllte `.env` ins Bündel.
 *
 *     node scripts/build-deploy-bundle.mjs --with-env pfad/zur/.env
 *
 * Standardmässig verweigert das Skript das (siehe Abschlussprüfung): ein
 * Bündel wird kopiert, weitergegeben und archiviert, und Zugangsdaten haben
 * darin nichts verloren. Wer es trotzdem will — weil das Bündel auf genau
 * einen eigenen Server geht und dort nichts mehr eingerichtet werden soll —
 * muss diesen Weg ausdrücklich wählen. Die Datei landet mit Rechten 600 und
 * das Skript sagt beim Bauen deutlich, was es getan hat.
 */
const withEnv = arg('--with-env', undefined);

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function step(message) {
  console.log(`\n[1m▸ ${message}[0m`);
}

/** Node-Version, mit der das Bündel gebaut wurde — landet in der README. */
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) {
  console.error(`✗ Node.js 20 oder neuer nötig, gefunden ${process.versions.node}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Bauen
// ---------------------------------------------------------------------------
/**
 * Liest die `NEXT_PUBLIC_*`-Werte aus einer .env für den Bau.
 *
 * Next.js ersetzt diese Variablen zur BAUZEIT durch Literale. Sie später in die
 * Laufzeit-`.env` zu schreiben hat keinerlei Wirkung — der Browser bekäme
 * weiterhin den Wert von damals. Fehlen sie beim Bauen, meldet die PWA
 * „Anmeldung ist nicht konfiguriert", obwohl die .env vollständig aussieht.
 * Deshalb kommen sie aus derselben Datei wie die Laufzeitwerte.
 */
function publicValuesFrom(envFile) {
  if (!envFile) return {};
  const source = resolve(root, envFile);
  if (!existsSync(source)) return {};
  const values = {};
  for (const line of readFileSync(source, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('NEXT_PUBLIC_')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const value = trimmed.slice(eq + 1).trim();
    if (value.length > 0) values[trimmed.slice(0, eq)] = value;
  }
  return values;
}

if (skipBuild) {
  console.log('▸ Bauen übersprungen (--skip-build)');
} else {
  step('Anwendungen bauen');
  const publicValues = publicValuesFrom(withEnv);
  for (const [key, value] of Object.entries(publicValues)) {
    console.log(`  ${key} = ${value.length > 40 ? `${value.slice(0, 32)}…` : value}`);
  }
  // `/api` als relativer Pfad hält das Bündel domänenunabhängig — der
  // Webserver leitet /api an die API weiter. Wer die API auf einer eigenen
  // Domain betreibt, setzt eine absolute URL und baut neu.
  run('pnpm', ['build'], {
    env: {
      ...process.env,
      ...publicValues,
      NEXT_PUBLIC_API_URL: publicValues.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '/api',
      NODE_ENV: 'production',
    },
  });
}

// ---------------------------------------------------------------------------
// 2. Zielverzeichnis
// ---------------------------------------------------------------------------
step(`Bündel schreiben nach ${outDir}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// 3. Node-Dienste: API und Worker
// ---------------------------------------------------------------------------
for (const [pkg, folder] of [
  ['@swissov/api', 'api'],
  ['@swissov/worker', 'worker'],
]) {
  step(`${pkg} → ${folder}/`);
  // `node-linker=hoisted` schreibt echte Verzeichnisse statt der üblichen
  // pnpm-Symlinks. Das ist hier entscheidend: das Bündel wird als Archiv
  // ausgeliefert, und nicht jedes Entpackprogramm — vor allem nicht die von
  // Windows und mancher Weboberfläche — stellt Symlinks wieder her. Ein Bündel
  // mit toten Verweisen sieht vollständig aus und startet trotzdem nicht.
  run('pnpm', [
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    `--filter=${pkg}`,
    join(outDir, folder),
  ]);
  // Quellen und Testkonfiguration gehören nicht auf einen Webserver.
  // `node_modules/.bin` enthält nur Symlinks auf Kommandozeilenwerkzeuge; die
  // Dienste starten über `node dist/index.js` und brauchen sie nie.
  for (const junk of ['src', 'tsconfig.json', 'vitest.config.ts', 'node_modules/.bin']) {
    rmSync(join(outDir, folder, junk), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 4. Next.js-Apps
// ---------------------------------------------------------------------------
for (const [app, folder] of [
  ['web', 'web'],
  ['admin', 'admin'],
]) {
  const standalone = join(root, 'apps', app, '.next', 'standalone');
  if (!existsSync(standalone)) {
    console.error(
      `✗ ${standalone} fehlt. Ist output: 'standalone' in apps/${app}/next.config.mjs gesetzt?`,
    );
    process.exit(1);
  }
  step(`apps/${app} → ${folder}/`);
  const target = join(outDir, folder);
  // `cp -a` und NICHT `cpSync`. Zwei Fallstricke stecken hier:
  //
  // 1. Die Symlinks müssen bleiben. Sie aufzulösen liegt nahe — ein Archiv
  //    ohne Symlinks lässt sich überall auspacken — zerstört aber die
  //    Modulauflösung: pnpm kodiert den Abhängigkeitsgraphen in den Verweisen.
  //    Ein Paket findet seine Abhängigkeiten als Geschwister in
  //    `.pnpm/<paket>/node_modules/`; anderswohin kopiert verliert es sie und
  //    der Server startet mit MODULE_NOT_FOUND.
  // 2. Sie müssen RELATIV bleiben. `cpSync` schreibt sie als absolute Pfade
  //    der Baumaschine — im Bündel sehen sie heil aus, zeigen aber auf ein
  //    Verzeichnis, das es auf dem Zielserver nicht gibt. Auf der Baumaschine
  //    selbst fällt das nicht auf, weil der Quellbaum dort noch liegt.
  mkdirSync(target, { recursive: true });
  run('cp', ['-a', `${standalone}/.`, target]);

  // Next kopiert `.next/static` und `public/` bewusst nicht in die
  // standalone-Ausgabe — sie sollen üblicherweise über ein CDN laufen. Ohne sie
  // liefert der Server HTML ohne JavaScript, Icons und Manifest aus: die PWA
  // wäre nicht installierbar und die Seite bliebe weiss.
  cpSync(join(root, 'apps', app, '.next', 'static'), join(target, 'apps', app, '.next', 'static'), {
    recursive: true,
  });
  const publicDir = join(root, 'apps', app, 'public');
  if (existsSync(publicDir)) {
    cpSync(publicDir, join(target, 'apps', app, 'public'), { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// 5. Einstiegspunkte für Plesk (Phusion Passenger)
// ---------------------------------------------------------------------------
step('Einstiegspunkte schreiben');

/**
 * Gemeinsamer Lader für die `.env` im Bündelwurzel.
 *
 * Bewusst ein eigener Parser statt `. .env` in einer Shell: ein Passwort mit
 * `$`, `#`, Leerzeichen oder Anführungszeichen würde von der Shell
 * interpretiert und käme verstümmelt oder gar nicht an. Hier wird jede Zeile
 * genau einmal am ersten `=` geteilt und sonst wörtlich genommen.
 *
 * Bereits gesetzte Werte haben Vorrang — Plesk kann Variablen selbst setzen.
 */
const ENV_LOADER = `import { existsSync, readFileSync } from 'node:fs';

export function loadBundleEnv(envPath) {
  if (!existsSync(envPath)) {
    console.error(\`Keine .env unter \${envPath} — die Anwendung startet ohne Konfiguration.\`);
    return;
  }
  for (const line of readFileSync(envPath, 'utf8').split('\\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
`;

/** Startdatei für Plesk („Application Startup File"). */
const startupFile = (entry) => `// Von scripts/build-deploy-bundle.mjs erzeugt.
//
// Startdatei für Plesk (Einstellung „Application Startup File").
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundleEnv } from './load-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
loadBundleEnv(resolve(here, '..', '.env'));

await import('${entry}');
`;

for (const [folder, entry] of [
  ['api', './dist/index.js'],
  ['worker', './dist/index.js'],
  ['web', './apps/web/server.js'],
  ['admin', './apps/admin/server.js'],
]) {
  writeFileSync(join(outDir, folder, 'load-env.mjs'), ENV_LOADER);
  writeFileSync(join(outDir, folder, 'app.mjs'), startupFile(entry));
}

/**
 * Wrapper für die Kommandozeilenwerkzeuge.
 *
 * Setzt `process.argv` so, als wäre das Werkzeug direkt aufgerufen worden. Ohne
 * das würde jedes Werkzeug, das seine Argumente über `process.argv.slice(2)`
 * oder `indexOf` liest, die eigenen Wrapper-Argumente als Nutzereingabe
 * missverstehen — `migrate` würde zu einem unbekannten Befehl.
 */
writeFileSync(
  join(outDir, 'worker', 'run-tool.mjs'),
  `// Von scripts/build-deploy-bundle.mjs erzeugt.
//
//     node run-tool.mjs <pfad-zum-werkzeug> [argumente…]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundleEnv } from './load-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
loadBundleEnv(resolve(here, '..', '.env'));

const [tool, ...args] = process.argv.slice(2);
if (!tool) {
  console.error('Aufruf: node run-tool.mjs <pfad-zum-werkzeug> [argumente…]');
  process.exit(2);
}

const entry = resolve(here, tool);
// Das Werkzeug soll seine Argumente an der gewohnten Stelle finden.
process.argv = [process.argv[0], entry, ...args];
await import(entry);
`,
);

// ---------------------------------------------------------------------------
// 6. Hilfsskripte: Migration, Seed, Fahrplanimport, Prüfung
// ---------------------------------------------------------------------------
step('Verwaltungsskripte schreiben');
const binDir = join(outDir, 'bin');
mkdirSync(binDir, { recursive: true });

/**
 * Alle Werkzeuge liegen im Worker-Bündel: es hängt von `@swissov/database` und
 * `@swissov/transit` ab, deren kompilierte CLIs damit unter
 * `worker/node_modules/@swissov/*` liegen. Ein zweites Bündel nur für die
 * Werkzeuge wäre rund 80 MB Duplikat.
 */
const tools = {
  migrate: ['@swissov/database/dist/cli.js', 'migrate'],
  'migrate-status': ['@swissov/database/dist/cli.js', 'status'],
  seed: ['@swissov/database/dist/cli.js', 'seed'],
  'import-gtfs': ['@swissov/transit/dist/cli.js'],
  'verify-sources': ['@swissov/transit/dist/scripts/verify-production.js'],
};

for (const [name, [entry, ...args]] of Object.entries(tools)) {
  const script = `#!/bin/sh
# Von scripts/build-deploy-bundle.mjs erzeugt.
#
# Die .env wird von run-tool.mjs gelesen, nicht von dieser Shell: ein Passwort
# mit \$, #, Leerzeichen oder Anführungszeichen würde hier sonst verstümmelt.
set -e
cd "$(dirname "$0")/../worker"
exec node run-tool.mjs "node_modules/${entry}"${args.map((a) => ` ${a}`).join('')} "$@"
`;
  writeFileSync(join(binDir, `${name}.sh`), script, { mode: 0o755 });
}

// Einrichtung und Selbsttest liegen als echte Dateien im Repository — sie sind
// zu umfangreich, um sie hier als Zeichenkette zu führen, und lassen sich so
// unabhängig prüfen.
// `cpSync` kennt kein Rechte-Argument (`mode` ist dort ein Kopier-Flag) —
// deshalb kopieren und danach ausführbar machen.
for (const [quelle, ziel] of [
  [join(root, 'scripts', 'deploy', 'install.sh'), join(outDir, 'install.sh')],
  [join(root, 'scripts', 'deploy', 'selftest.sh'), join(binDir, 'selftest.sh')],
  [join(root, 'scripts', 'deploy', 'configure-env.mjs'), join(binDir, 'configure-env.mjs')],
]) {
  cpSync(quelle, ziel);
  chmodSync(ziel, 0o755);
}

// ---------------------------------------------------------------------------
// 7. systemd-Unit für den Worker
// ---------------------------------------------------------------------------
mkdirSync(join(outDir, 'systemd'), { recursive: true });
writeFileSync(
  join(outDir, 'systemd', 'swissov-worker.service'),
  `# Der Worker ist KEINE Webanwendung — Passenger kann ihn nicht betreiben.
# Ohne ihn gibt es keine Echtzeitdaten, keine Benachrichtigungen und keine
# Aufräumläufe für abgelaufene Meldungen.
#
#   sudo cp swissov-worker.service /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now swissov-worker
#
# WorkingDirectory und User an die Plesk-Installation anpassen.
[Unit]
Description=Schweizer OeV Live — Hintergrunddienst
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=CHANGEME
WorkingDirectory=/var/www/vhosts/CHANGEME/swissov/worker
ExecStart=/usr/bin/node app.mjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`,
);

// ---------------------------------------------------------------------------
// 8. Konfigurationsvorlage
// ---------------------------------------------------------------------------
step('Konfigurationsvorlage schreiben');
writeFileSync(
  join(outDir, '.env.example'),
  `###############################################################################
# Produktionskonfiguration — nach .env kopieren und ausfüllen.
#
#   cp .env.example .env && nano .env
#
# Diese Datei wird von allen Diensten im Bündel gelesen (api, worker, web,
# admin) und darf NIE über den Webserver erreichbar sein. Sie gehört in das
# Bündelwurzelverzeichnis, nicht in ein Dokumentenverzeichnis.
###############################################################################

NODE_ENV=production
LOG_LEVEL=info

# --- Datenbank ---------------------------------------------------------------
# Eigene PostgreSQL 16 mit PostGIS 3.4. Der Schweizer Fahrplan belegt rund 8 GB;
# mindestens 20 GB freier Platz einplanen.
#
# Aufbau:  postgresql://<benutzer>:<pw>@<host>:5432/<datenbank>
# Beispiel: postgresql://swissov:geheim@127.0.0.1:5432/swissov
#
# install.sh trägt den Wert ein, wenn er beim Aufruf mitgegeben wird.
DATABASE_URL=

# --- API ---------------------------------------------------------------------
API_PORT=3001
API_HOST=127.0.0.1
# PFLICHT: die echte Domain der PWA. Bleibt die Liste leer, verwirft der Browser
# jede Antwort — die App bleibt leer, ohne Fehler im Serverlog.
API_CORS_ORIGINS=https://DEINE-DOMAIN
# PFLICHT: 32+ Zeichen Zufall. Erzeugen: openssl rand -base64 48
API_INTERNAL_SECRET=
API_PUBLIC_URL=https://DEINE-DOMAIN/api

# --- Supabase (nur Anmeldung und Realtime) -----------------------------------
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# --- opentransportdata.swiss (je Dienst ein eigenes Token) -------------------
OPENTRANSPORTDATA_CKAN_API_KEY=
OPENTRANSPORTDATA_GTFS_RT_API_KEY=
OPENTRANSPORTDATA_GTFS_SA_API_KEY=
# Optional:
OJP_API_KEY=

# --- Web Push ----------------------------------------------------------------
# Einmalig erzeugen und sicher ablegen: ein Wechsel macht ALLE Abos ungültig.
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:push@DEINE-DOMAIN

# --- Ports der Next.js-Dienste ----------------------------------------------
# Plesk/Passenger setzt PORT selbst; diese Werte gelten beim direkten Start.
PORT=3002
ADMIN_PORT=3000
WORKER_PORT=3003

# --- Werte für den Browser (BAUZEIT!) ---------------------------------------
# ACHTUNG: Diese Zeilen wirken NICHT zur Laufzeit. Next.js ersetzt sie beim
# Bauen durch Literale — sie stehen bereits im ausgelieferten JavaScript. Eine
# Änderung hier bleibt wirkungslos; dafür muss das Bündel neu gebaut werden:
#
#     node scripts/build-deploy-bundle.mjs --with-env <diese-datei>
#
# Sie stehen hier trotzdem, damit ein Neubau dieselben Werte verwendet.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_MAP_TILE_URL=https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json
NEXT_PUBLIC_API_URL=/api
`,
);

// ---------------------------------------------------------------------------
// 9. README
// ---------------------------------------------------------------------------
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
writeFileSync(
  join(outDir, 'README.md'),
  `# Schweizer ÖV Live — Auslieferungsbündel

Version ${pkgVersion} · gebaut mit Node.js ${process.versions.node} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC

Dieses Verzeichnis ist selbsttragend: **kein \`npm install\`, kein pnpm, kein
Build auf dem Server.** Nötig ist Node.js 20 oder neuer.

---

## Kurzfassung

    ./install.sh

Das Skript prüft die Voraussetzungen, erzeugt alle Geheimnisse, legt das
Datenbankschema an, importiert auf Wunsch den Fahrplan und beweist am Ende mit
einem Selbsttest, dass API und PWA wirklich antworten. Es ist mehrfach
ausführbar und überschreibt keine vorhandene \`.env\`.

**Zwei Dinge kann kein Skript erledigen** — sie stehen unten ausführlich:

1. **PostGIS installieren.** Braucht root auf dem Server. Ohne PostGIS
   scheitert die erste Migration. \`install.sh\` prüft das als Erstes und sagt
   genau, was fehlt.
2. **Plesk die drei Dienste bekannt machen.** Drei Einträge unter „Node.js"
   und eine nginx-Weiterleitung — \`install.sh\` druckt sie am Ende zum
   Abschreiben aus.

---

## Was hier liegt

| Ordner | Was es ist | Wie es läuft |
| --- | --- | --- |
| \`api/\` | REST-API (Fastify) | Plesk-Node-App, Startdatei \`app.mjs\` |
| \`web/\` | die PWA (Next.js) | Plesk-Node-App, Startdatei \`app.mjs\` |
| \`admin/\` | Moderationsportal (Next.js) | Plesk-Node-App, eigene Subdomain |
| \`worker/\` | Hintergrunddienst | Plesk-Node-App oder systemd — siehe 7. |
| \`install.sh\` | richtet alles ein | einmal ausführen |
| \`bin/\` | Migration, Seed, Import, Selbsttest | von Hand über SSH |
| \`systemd/\` | Unit-Datei für den Worker | nur ohne Plesk-Node-App nötig |
| \`.env.example\` | Konfigurationsvorlage | \`install.sh\` füllt sie aus |

---

## Vorbedingungen auf dem Server

**PostgreSQL 16 mit PostGIS 3.4.** Das ist die Stelle, an der eine
Standard-Plesk-Installation nicht ausreicht: Plesk bringt MySQL mit, PostgreSQL
ist eine Zusatzkomponente und **PostGIS in aller Regel gar nicht**. Ohne PostGIS
scheitert die erste Migration — die Anwendung rechnet mit Geometrien in der
Datenbank, das ist nicht nachrüstbar.

    sudo apt install postgresql-16 postgresql-16-postgis-3
    sudo -u postgres createuser swissov --pwprompt
    sudo -u postgres createdb swissov --owner=swissov

Die Extensions legt die erste Migration selbst an (\`postgis\`, \`pgcrypto\`,
\`pg_trgm\`, \`unaccent\`); der Datenbankbenutzer braucht dafür einmalig
Superuser-Rechte oder ein vorbereitetes Template.

Ausserdem: **HTTPS mit gültigem Zertifikat.** Service Worker, Standortabfrage
und Push funktionieren ausschliesslich über HTTPS. In Plesk: „Let's
Encrypt"-Erweiterung, dann „HTTP zu HTTPS umleiten" aktivieren.

---

## Einrichtung

### 1. Hochladen

Das ganze Verzeichnis nach \`/var/www/vhosts/DEINE-DOMAIN/swissov/\` legen —
**nicht** in \`httpdocs\`. Es darf nicht über den Webserver erreichbar sein: die
\`.env\` enthält den Service-Role-Key und den VAPID-Private-Key.

### 2. Konfigurieren

    cd /var/www/vhosts/DEINE-DOMAIN/swissov
    cp .env.example .env
    nano .env
    chmod 600 .env

\`API_INTERNAL_SECRET\` erzeugen: \`openssl rand -base64 48\`

VAPID-Schlüsselpaar erzeugen (einmalig, dann sicher ablegen — ein Wechsel macht
alle bestehenden Push-Abos ungültig):

    node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});console.log('public =',k.publicKey.export({type:'spki',format:'der'}).subarray(26).toString('base64url'));console.log('private=',k.privateKey.export({type:'pkcs8',format:'der'}).subarray(36,68).toString('base64url'))"

### 3. Datenbank vorbereiten

    ./bin/migrate.sh
    ./bin/seed.sh
    ./bin/migrate-status.sh      # zeigt, was angewendet wurde

### 4. Zugänge prüfen, bevor importiert wird

    ./bin/verify-sources.sh

Das Skript lädt nichts herunter und schreibt nichts. Es prüft jeden Dienst von
opentransportdata.swiss mit **seinem eigenen** Token und benennt jeden Fehler.
Erst wenn hier alles steht, lohnt der Import.

### 5. Fahrplan importieren

    ./bin/import-gtfs.sh

**Dauert 10–40 Minuten und belegt rund 8 GB.** Am besten in \`screen\` oder
\`tmux\` starten. Erreicht der Server opentransportdata.swiss nicht, den
Datensatz per Browser herunterladen und übergeben:

    ./bin/import-gtfs.sh --file /pfad/zu/gtfs.zip

### 6. Die drei Node-Dienste in Plesk anlegen

Für \`api/\` und \`web/\` je unter **Websites & Domains → Node.js**:

| Einstellung | \`web/\` | \`api/\` |
| --- | --- | --- |
| Application Root | \`swissov/web\` | \`swissov/api\` |
| Application Startup File | \`app.mjs\` | \`app.mjs\` |
| Application Mode | production | production |
| Document Root | \`httpdocs\` | — |

Dann **nicht** „NPM install" anklicken — die Abhängigkeiten liegen bereits im
Bündel, und ein Install würde die aufgelösten internen Pakete zerstören.

Die API muss unter \`/api\` derselben Domain erreichbar sein. In Plesk unter
**Apache & nginx Settings → Additional nginx directives**:

    location /api/ {
      proxy_pass http://127.0.0.1:3001/;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

Warum \`/api\` auf derselben Domain: Die PWA ist mit \`NEXT_PUBLIC_API_URL=/api\`
gebaut, also mit einem relativen Pfad. Dadurch läuft dasselbe Bündel auf jeder
Domain. Soll die API unter einer eigenen Domain laufen, muss die PWA mit
\`NEXT_PUBLIC_API_URL=https://api.example.ch\` **neu gebaut** werden — Next.js
setzt diese Werte zur Bauzeit ein.

### 7. Worker

Ohne ihn gibt es **keine Verspätungen, keine Störungsmeldungen, keine
Benachrichtigungen und keine Aufräumläufe** — die App zeigt dann nur
Fahrplanzeiten und sagt das auch.

Der Worker bringt einen eigenen Health-Endpunkt mit und lässt sich deshalb wie
die anderen beiden als Plesk-Node-App eintragen (Application Root
\`swissov/worker\`, Startup File \`app.mjs\`). Das ist der einfachere Weg und
braucht kein root.

Wer root hat, kann ihn stattdessen als Systemdienst führen — das überlebt auch
einen Neustart ohne Web-Anfrage:

    sudo cp systemd/swissov-worker.service /etc/systemd/system/
    sudo nano /etc/systemd/system/swissov-worker.service   # User + Pfad anpassen
    sudo systemctl daemon-reload
    sudo systemctl enable --now swissov-worker
    sudo journalctl -u swissov-worker -f

### 8. Prüfen

    ./bin/selftest.sh

Startet API und PWA auf freien Ports, prüft Health, Bereitschaft,
Datenbankverbindung, Haltestellensuche, Manifest und Service Worker — und
beendet beide wieder. Ein laufender Betrieb wird dabei nicht gestört.

Danach über die echte Domain:

    curl https://DEINE-DOMAIN/api/health          # {"status":"ok"}
    curl https://DEINE-DOMAIN/api/ready           # Zustand jeder Komponente

\`/ready\` nennt jede Komponente einzeln. \`realtime: false\` bedeutet: seit über
zehn Minuten kein erfolgreicher Abruf — dann läuft der Worker nicht.

---

## Was dieses Bündel NICHT enthält

Ehrlich benannt, damit es keine Überraschung wird:

1. **Fahrplandaten.** Sie sind zu gross und ändern sich täglich. Schritt 5.
2. **Rechtliche Texte.** Datenschutzerklärung, Impressum und
   Nutzungsbedingungen fehlen. Ohne sie darf die App nicht öffentlich gehen —
   Impressumspflicht, und die Kategorie „Kontrolle" ist datenschutz- und
   beförderungsrechtlich nicht trivial. Entwurf und offene Fragen:
   \`docs/privacy-architecture.md\` im Quellrepository, markiert mit
   \`[JURISTISCH PRÜFEN]\`.
3. **Datenbank-Backups.** Ein ungetestetes Backup ist kein Backup.
4. **Monitoring.** \`/health\` und \`/ready\` sind dafür vorgesehen und vom Rate
   Limit ausgenommen.
5. **Rate Limiting am Reverse Proxy.** Die API begrenzt selbst, aber eine
   zweite Ebene davor ist empfohlen.

## Aktualisieren

Neues Bündel bauen, hochladen, dann:

    ./bin/migrate.sh
    # Plesk: bei web/ und api/ auf „Restart App"
    sudo systemctl restart swissov-worker

\`.env\` und die Datenbank bleiben unberührt. Migrationen sind vorwärtskompatibel
angelegt: die alte Version läuft mit dem neuen Schema weiter, ein Rückbau ist
also ohne Datenverlust möglich.
`,
);

// ---------------------------------------------------------------------------
// 10. Abschlussprüfung
// ---------------------------------------------------------------------------
step('Bündel prüfen');

/**
 * Der schlimmste denkbare Fehler dieses Skripts wäre, echte Zugangsdaten
 * mitzuliefern: das Bündel wird auf einen Webserver kopiert, weitergegeben und
 * möglicherweise archiviert. Deshalb wird hier ausdrücklich nachgesehen, statt
 * darauf zu vertrauen, dass keine `.env` kopiert wurde.
 */
if (withEnv) {
  const source = resolve(root, withEnv);
  if (!existsSync(source)) {
    console.error(`✗ --with-env: ${source} existiert nicht.`);
    process.exit(1);
  }
  cpSync(source, join(outDir, '.env'));
  execFileSync('chmod', ['600', join(outDir, '.env')]);
  console.log('  ⚠ Eine ausgefüllte .env liegt im Bündel (Rechte 600).');
  console.log('    Dieses Bündel enthält damit Zugangsdaten und darf weder');
  console.log('    weitergegeben noch in ein Repository gelegt werden.');
}

const strayEnvFiles = execFileSync('find', [outDir, '-name', '.env', '-o', '-name', '.env.*', '!', '-name', '.env.example'])
  .toString()
  .split('\n')
  .filter(Boolean)
  // Die bewusst mitgegebene .env ist kein Versehen — alles andere schon.
  .filter((file) => !(withEnv && file === join(outDir, '.env')));

if (strayEnvFiles.length > 0) {
  console.error('✗ Das Bündel enthält Konfigurationsdateien mit möglichen Zugangsdaten:');
  for (const file of strayEnvFiles) console.error(`    ${file}`);
  console.error('  Abbruch — sonst würden Secrets mit ausgeliefert.');
  process.exit(1);
}
console.log(
  withEnv
    ? '  ✓ genau eine .env im Bündel — die ausdrücklich mitgegebene'
    : '  ✓ keine .env im Bündel (nur .env.example)',
);

// Fehlt eines dieser Stücke, startet auf dem Server etwas nicht — besser hier
// auffallen als dort.
const required = [
  'api/app.mjs',
  'api/dist/index.js',
  'api/node_modules/@swissov/database/dist/cli.js',
  'worker/app.mjs',
  'worker/run-tool.mjs',
  'worker/node_modules/@swissov/transit/dist/cli.js',
  'worker/node_modules/@swissov/transit/dist/scripts/verify-production.js',
  'worker/node_modules/@swissov/database/migrations/0001_extensions.sql',
  'web/app.mjs',
  'web/apps/web/server.js',
  'web/apps/web/.next/static',
  'web/apps/web/public/manifest.webmanifest',
  'admin/apps/admin/server.js',
  'bin/migrate.sh',
  'bin/selftest.sh',
  'install.sh',
  '.env.example',
  'README.md',
];
const missing = required.filter((entry) => !existsSync(join(outDir, entry)));
if (missing.length > 0) {
  console.error('✗ Im Bündel fehlt:');
  for (const entry of missing) console.error(`    ${entry}`);
  process.exit(1);
}
console.log(`  ✓ alle ${required.length} erwarteten Bestandteile vorhanden`);

/**
 * Kein Symlink darf aus dem Bündel hinauszeigen.
 *
 * Die Next.js-Ausgabe braucht relative Symlinks — ohne sie findet Node die
 * Module nicht. Ein ABSOLUTER Verweis dagegen zeigt auf einen Pfad der
 * Baumaschine und ist auf dem Zielserver tot. Der Unterschied ist im Bündel
 * unsichtbar: beides sieht nach einem intakten Link aus, und solange der
 * Quellbaum auf derselben Maschine liegt, funktioniert sogar der absolute.
 * Erst auf dem fremden Server bricht es — als MODULE_NOT_FOUND, nicht als
 * erkennbarer Kopierfehler.
 */
const absoluteLinks = execFileSync('find', [outDir, '-type', 'l'])
  .toString()
  .split('\n')
  .filter(Boolean)
  .filter((link) => readlinkSync(link).startsWith('/'));

if (absoluteLinks.length > 0) {
  console.error(`✗ ${absoluteLinks.length} Symlinks zeigen auf absolute Pfade:`);
  for (const link of absoluteLinks.slice(0, 5)) {
    console.error(`    ${link.replace(outDir, '')} → ${readlinkSync(link)}`);
  }
  console.error('  Auf dem Zielserver gibt es diese Pfade nicht — das Bündel wäre unbrauchbar.');
  process.exit(1);
}

const linkCount = execFileSync('find', [outDir, '-type', 'l']).toString().split('\n').filter(Boolean).length;
console.log(`  ✓ alle ${linkCount} Symlinks zeigen relativ ins Bündel`);

// ---------------------------------------------------------------------------
// 11. Ergebnis
// ---------------------------------------------------------------------------
step('Fertig');
const size = execFileSync('du', ['-sh', outDir]).toString().split('\t')[0];
console.log(`  ${outDir}`);
console.log(`  Grösse: ${size}`);
console.log('');
console.log('  Nächster Schritt: Bündel packen und hochladen —');
console.log(`      tar -czf swissov-deploy.tar.gz -C ${dirname(outDir)} ${outDir.split('/').pop()}`);
console.log('');
