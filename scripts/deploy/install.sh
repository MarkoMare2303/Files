#!/bin/sh
#
# Richtet Schweizer ÖV Live auf diesem Server ein.
#
#     ./install.sh
#
# Das Skript ist absichtlich mehrfach ausführbar: Es überschreibt keine
# vorhandene .env, überspringt bereits angewendete Migrationen und bricht bei
# jedem Fehler ab, statt halbfertig weiterzulaufen.
#
# Optionen (sonst wird gefragt):
#   --db <url>        PostgreSQL-Verbindung
#   --domain <name>   Domain der Website (sonst aus dem Pfad geraten)
#   --import          Fahrplan direkt importieren (dauert 10–40 Minuten)
#   --no-import       Fahrplanimport überspringen, nicht fragen
#   --yes             keine Rückfragen; verlangt --db
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"

DB_URL=""
DOMAIN=""
DO_IMPORT="frage"
ASSUME_YES="nein"

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB_URL="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --import) DO_IMPORT="ja"; shift ;;
    --no-import) DO_IMPORT="nein"; shift ;;
    --yes) ASSUME_YES="ja"; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

# --- Ausgabe ---------------------------------------------------------------
if [ -t 1 ]; then B=$(printf '\033[1m'); N=$(printf '\033[0m'); else B=""; N=""; fi
schritt() { echo ""; echo "${B}▸ $1${N}"; }
ok()      { echo "  ✓ $1"; }
warnung() { echo "  ! $1"; }
fehler()  { echo "" >&2; echo "✗ $1" >&2; shift; for z in "$@"; do echo "  $z" >&2; done; exit 1; }

echo "${B}Schweizer ÖV Live — Einrichtung${N}"
echo "──────────────────────────────────────────────────────────"

# --- 1. Voraussetzungen ----------------------------------------------------
schritt "Voraussetzungen prüfen"

command -v node >/dev/null 2>&1 || fehler "Node.js fehlt." \
  "Node.js 20 oder neuer wird gebraucht. In Plesk: Erweiterung „Node.js\"." \
  "Prüfen mit: node --version"

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || fehler "Node.js $(node --version) ist zu alt — 20 oder neuer nötig."
ok "Node.js $(node --version)"

# --- 2. Datenbankverbindung ------------------------------------------------
schritt "Datenbank"

# Reihenfolge: ausdrückliche Angabe schlägt Datei, Datei schlägt Rückfrage.
# Der Platzhalter aus der Vorlage zählt dabei NICHT als gesetzter Wert — sonst
# würde er ein übergebenes --db überstimmen und die Anmeldung scheitern.
VORHANDENE_DB=""
if [ -f .env ]; then
  VORHANDENE_DB=$(grep '^DATABASE_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)
  case "$VORHANDENE_DB" in
    ''|*benutzer:passwort*) VORHANDENE_DB="" ;;
  esac
fi

# Eine ausdrückliche Angabe auf der Kommandozeile ersetzt auch einen bereits
# eingetragenen Wert — sonst liesse sich eine falsche Zeile nicht korrigieren.
DB_ERZWINGEN=""
if [ -n "$DB_URL" ]; then
  DB_ERZWINGEN="!"
  ok "Verbindung aus --db übernommen"
elif [ -n "$VORHANDENE_DB" ]; then
  DB_URL="$VORHANDENE_DB"
  ok "Verbindung aus vorhandener .env übernommen"
elif [ "$ASSUME_YES" = "ja" ]; then
  fehler "--yes ohne --db: die Datenbankverbindung kann nicht geraten werden."
else
  echo "  Diese Anwendung braucht eine eigene PostgreSQL 16 mit PostGIS 3.4."
  echo "  Der Schweizer Fahrplan belegt rund 8 GB."
  echo ""
  echo "  Beispiel: postgresql://swissov:GEHEIM@127.0.0.1:5432/swissov"
  printf "  Verbindung: "
  read -r DB_URL
  [ -n "$DB_URL" ] || fehler "Ohne Datenbankverbindung geht es nicht weiter."
fi

# --- 3. Domain -------------------------------------------------------------
schritt "Domain"
# Reihenfolge: --domain, dann die bereits eingetragene, dann der Pfad, dann
# fragen. Ein zweiter Lauf soll nichts erneut erfragen, was schon feststeht.
if [ -z "$DOMAIN" ] && [ -f .env ]; then
  DOMAIN=$(grep '^API_CORS_ORIGINS=https://' .env 2>/dev/null | head -1 |
    sed -n 's|^API_CORS_ORIGINS=https://\([^,]*\).*|\1|p' || true)
  case "$DOMAIN" in *DEINE-DOMAIN*) DOMAIN="" ;; esac
  [ -n "$DOMAIN" ] && ok "Domain aus vorhandener .env übernommen"
fi
if [ -z "$DOMAIN" ]; then
  # Plesk legt Websites unter /var/www/vhosts/<domain>/ ab — daraus lässt sich
  # die Domain zuverlässig ableiten, ohne zu fragen.
  DOMAIN=$(printf '%s' "$HERE" | sed -n 's|.*/vhosts/\([^/]*\)/.*|\1|p')
fi
if [ -z "$DOMAIN" ] && [ "$ASSUME_YES" != "ja" ]; then
  printf "  Domain der Website (z. B. oev.example.ch): "
  read -r DOMAIN
fi
if [ -n "$DOMAIN" ]; then
  ok "Domain: $DOMAIN"
else
  DOMAIN="localhost"
  warnung "Keine Domain erkannt — es wird 'localhost' eingetragen."
  warnung "Vor dem Livegang API_CORS_ORIGINS in der .env anpassen."
fi

# --- 4. Konfiguration ------------------------------------------------------
schritt "Konfiguration"

if [ ! -f .env ]; then
  cp .env.example .env
  ok ".env aus der Vorlage angelegt"
fi
chmod 600 .env

# Zufallswerte für die Felder, die noch leer sind. Das VAPID-Paar ist ein
# P-256-Schlüssel nach RFC 8030; steht bereits eines in der .env, bleibt es —
# ein Wechsel würde ALLE bestehenden Push-Abos ungültig machen.
GEHEIMNIS=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
VAPID=$(node -e "
  const c = require('crypto');
  const k = c.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = k.publicKey.export({ type: 'spki', format: 'der' }).subarray(26).toString('base64url');
  const prv = k.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(36, 68).toString('base64url');
  console.log(pub + ' ' + prv);
")
VAPID_PUB=$(printf '%s' "$VAPID" | cut -d' ' -f1)
VAPID_PRV=$(printf '%s' "$VAPID" | cut -d' ' -f2)

# Ergänzt ausschliesslich leere Felder und Platzhalter — nie einen echten Wert.
BERICHT=$(node bin/configure-env.mjs .env \
  "${DB_ERZWINGEN}DATABASE_URL=$DB_URL" \
  "API_CORS_ORIGINS=https://$DOMAIN" \
  "API_PUBLIC_URL=https://$DOMAIN/api" \
  "API_INTERNAL_SECRET=$GEHEIMNIS" \
  "WEB_PUSH_VAPID_PUBLIC_KEY=$VAPID_PUB" \
  "WEB_PUSH_VAPID_PRIVATE_KEY=$VAPID_PRV" \
  "WEB_PUSH_SUBJECT=mailto:push@$DOMAIN")

printf '%s\n' "$BERICHT" | grep '^GESETZT' | while read -r _ SCHLUESSEL; do
  echo "  ✓ $SCHLUESSEL erzeugt bzw. eingetragen"
done
ANZAHL_BEHALTEN=$(printf '%s\n' "$BERICHT" | grep -c '^BEHALTEN' || true)
[ "$ANZAHL_BEHALTEN" -gt 0 ] && ok "$ANZAHL_BEHALTEN vorhandene Werte unverändert übernommen"

case "$BERICHT" in
  *"GESETZT WEB_PUSH_VAPID_PRIVATE_KEY"*)
    warnung "Das VAPID-Paar ist neu — die .env jetzt sichern. Ein späterer Wechsel"
    warnung "macht alle bestehenden Push-Abos ungültig." ;;
esac

# Ohne eine Möglichkeit zur Token-Prüfung verweigert die API in Produktion den
# Start. Das lieber hier sagen als im Selbsttest.
if ! grep -q '^SUPABASE_URL=..*' .env && ! grep -q '^SUPABASE_JWT_SECRET=..*' .env; then
  fehler "Es fehlen die Supabase-Zugangsdaten." \
    "Ohne SUPABASE_URL (oder SUPABASE_JWT_SECRET) kann die API keine Anmeldung" \
    "prüfen und startet in Produktion nicht." \
    "" \
    "Im Supabase-Dashboard unter Project Settings → API zu finden und in die" \
    ".env einzutragen:" \
    "  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY," \
    "  SUPABASE_JWT_SECRET und NEXT_PUBLIC_SUPABASE_URL/-ANON_KEY" \
    "" \
    "Danach ./install.sh erneut ausführen."
fi
ok "Anmeldung ist konfiguriert"

# --- 5. Schema -------------------------------------------------------------
#
# Datenbankverbindung und PostGIS werden hier zugleich geprüft: die erste
# Migration legt die Extensions an. Ein eigener Vorabtest bräuchte einen
# direkten `pg`-Zugriff — der liegt im Bündel nur verschachtelt unter
# `@swissov/database` und wäre eine zweite, ungeprüfte Zugriffsart. Diese hier
# ist dieselbe, die auch im Betrieb läuft.
schritt "Datenbankschema anlegen"
PROTOKOLL=$(mktemp)
if ./bin/migrate.sh >"$PROTOKOLL" 2>&1; then
  if grep -q '^✓' "$PROTOKOLL"; then ok "Migrationen angewendet"; else ok "Schema ist aktuell"; fi
  rm -f "$PROTOKOLL"
else
  AUSGABE=$(cat "$PROTOKOLL")
  rm -f "$PROTOKOLL"
  case "$AUSGABE" in
    *ECONNREFUSED*|*ENOTFOUND*|*"getaddrinfo"*)
      fehler "Die Datenbank ist nicht erreichbar." \
        "DATABASE_URL in der .env prüfen, dann ./install.sh erneut ausführen." \
        "" \
        "Datenbank und Benutzer anlegen (als root auf dem Server):" \
        "  sudo -u postgres createuser swissov --pwprompt" \
        "  sudo -u postgres createdb swissov --owner=swissov" ;;
    *"password authentication"*|*"Passwort-Authentifizierung"*)
      fehler "Anmeldung an der Datenbank abgelehnt." \
        "Benutzer oder Passwort in DATABASE_URL stimmen nicht." ;;
    *postgis*|*PostGIS*|*POSTGIS*)
      fehler "PostGIS fehlt auf diesem Server." \
        "Die Anwendung speichert Haltestellen und Strecken als Geometrien;" \
        "ohne PostGIS gibt es kein Schema. Nachrüstbar nur mit root-Rechten:" \
        "" \
        "  sudo apt install postgresql-16-postgis-3" \
        "" \
        "Auf Shared Hosting ohne root geht das nicht — dort braucht es einen" \
        "Server, auf dem PostGIS installiert werden kann (z. B. einen VPS)." \
        "" \
        "Ursprüngliche Meldung:" \
        "$(printf '%s' "$AUSGABE" | grep -i postgis | head -2)" ;;
    *"permission denied"*|*"keine Berechtigung"*)
      fehler "Der Datenbankbenutzer darf das Schema nicht anlegen." \
        "Für die Erstinstallation braucht er Superuser-Rechte (die Extensions)." \
        "  sudo -u postgres psql -c 'ALTER USER swissov SUPERUSER;'" \
        "Danach lassen sie sich wieder entziehen." ;;
    *)
      printf '%s\n' "$AUSGABE" | tail -20 >&2
      fehler "Die Migration ist fehlgeschlagen (Ausgabe oben)." ;;
  esac
fi

./bin/seed.sh >/dev/null 2>&1 || fehler "Das Einspielen der Stammdaten ist fehlgeschlagen."
ok "Stammdaten eingespielt (Kategorien, Feature-Flags)"

# --- 6. Externe Quellen ----------------------------------------------------
schritt "Datenquellen prüfen"
if ./bin/verify-sources.sh >/tmp/swissov-quellen.$$ 2>&1; then
  ok "opentransportdata.swiss erreichbar, alle Pflichtquellen bereit"
  QUELLEN_OK="ja"
else
  QUELLEN_OK="nein"
  warnung "Nicht alle Quellen sind erreichbar:"
  grep -E '^✗' /tmp/swissov-quellen.$$ | sed 's/^/    /' >&2 || true
  warnung "Ohne sie gibt es keine Fahrplandaten. Prüfen: ./bin/verify-sources.sh"
fi
rm -f /tmp/swissov-quellen.$$

# --- 7. Fahrplan -----------------------------------------------------------
#
# Ein erneuter Import ist ungefährlich: der Importer vergleicht die Prüfsumme
# des Datensatzes und überspringt ihn, wenn er unverändert ist. Deshalb wird
# hier nicht erst gezählt, was schon da ist.
schritt "Fahrplandaten"
if [ "$QUELLEN_OK" != "ja" ]; then
  warnung "Import übersprungen — die Quellen sind nicht erreichbar."
  warnung "Später nachholen: ./bin/import-gtfs.sh"
else
  if [ "$DO_IMPORT" = "frage" ] && [ "$ASSUME_YES" != "ja" ]; then
    echo "  Der Import dauert 10–40 Minuten und belegt rund 8 GB."
    printf "  Jetzt importieren? [J/n] "
    read -r ANTWORT
    case "$ANTWORT" in [nN]*) DO_IMPORT="nein" ;; *) DO_IMPORT="ja" ;; esac
  fi
  if [ "$DO_IMPORT" = "ja" ]; then
    echo "  Läuft — bitte nicht abbrechen."
    ./bin/import-gtfs.sh || fehler "Der Fahrplanimport ist fehlgeschlagen." \
      "Erreicht der Server opentransportdata.swiss nicht, den Datensatz per" \
      "Browser laden und übergeben: ./bin/import-gtfs.sh --file /pfad/gtfs.zip"
    ok "Fahrplan importiert"
  else
    warnung "Import übersprungen. Ohne ihn zeigt die App keine Fahrten."
    warnung "Nachholen mit: ./bin/import-gtfs.sh"
  fi
fi

# --- 8. Selbsttest ---------------------------------------------------------
schritt "Selbsttest"
./bin/selftest.sh || fehler "Der Selbsttest ist fehlgeschlagen (Ausgabe oben)."

# --- 9. Was jetzt noch von Hand kommt --------------------------------------
cat <<ENDE

──────────────────────────────────────────────────────────
${B}Die Einrichtung ist abgeschlossen.${N}

Was dieses Skript NICHT tun kann — Plesk muss die Dienste kennen.
Drei Einträge unter „Websites & Domains → Node.js":

  ┌────────────────────┬──────────────────┬────────────┐
  │ Application Root   │ Startup File     │ Mode       │
  ├────────────────────┼──────────────────┼────────────┤
  │ …/swissov/web      │ app.mjs          │ production │
  │ …/swissov/api      │ app.mjs          │ production │
  │ …/swissov/worker   │ app.mjs          │ production │
  └────────────────────┴──────────────────┴────────────┘

  ⚠ „NPM install" NICHT anklicken — die Abhängigkeiten liegen bereits im
    Bündel, ein Install würde die aufgelösten internen Pakete zerstören.

Und eine Weiterleitung, damit die App ihre API erreicht.
Unter „Apache & nginx Settings → Additional nginx directives":

  location /api/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

Danach: https://$DOMAIN aufrufen.

Vor dem öffentlichen Start bleiben Datenschutzerklärung, Impressum und
Nutzungsbedingungen — die kann kein Skript schreiben. Siehe README.md.
ENDE
