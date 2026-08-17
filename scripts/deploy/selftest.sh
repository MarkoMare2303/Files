#!/bin/sh
#
# Startet API und PWA aus dem Bündel, prüft sie und beendet sie wieder.
#
#     ./bin/selftest.sh
#
# Sinn: Nach der Einrichtung soll nicht die Vermutung stehen, dass es läuft,
# sondern der Nachweis. Geprüft wird auf freien Ports, damit ein bereits
# laufender Betrieb nicht gestört wird.
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"

if [ -t 1 ]; then B=$(printf '\033[1m'); N=$(printf '\033[0m'); else B=""; N=""; fi
ok()     { echo "  ✓ $1"; }
schlecht() { echo "  ✗ $1" >&2; FEHLER=$((FEHLER + 1)); }
FEHLER=0

API_PORT_TEST=$(node -e "console.log(20000 + Math.floor(Math.random() * 20000))")
WEB_PORT_TEST=$((API_PORT_TEST + 1))
API_LOG=$(mktemp)
WEB_LOG=$(mktemp)
API_PID=""
WEB_PID=""

aufraeumen() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
  rm -f "$API_LOG" "$WEB_LOG"
}
trap aufraeumen EXIT INT TERM

# `curl` ist nicht überall vorhanden; Node kann es selbst.
hole() {
  node --input-type=module -e "
    try {
      const antwort = await fetch('$1', { signal: AbortSignal.timeout(8000) });
      const text = await antwort.text();
      console.log(antwort.status + ' ' + text.slice(0, 400).replace(/\n/g, ' '));
    } catch (fehler) {
      console.log('000 ' + fehler.message);
    }
  " 2>/dev/null
}

warte_auf() {
  i=0
  while [ "$i" -lt 40 ]; do
    case "$(hole "$1")" in 000*) ;; *) return 0 ;; esac
    i=$((i + 1))
    sleep 1
  done
  return 1
}

echo "  Starte API und PWA auf freien Ports ($API_PORT_TEST/$WEB_PORT_TEST) …"

(cd api && API_PORT=$API_PORT_TEST API_HOST=127.0.0.1 node app.mjs >"$API_LOG" 2>&1) &
API_PID=$!
(cd web && PORT=$WEB_PORT_TEST node app.mjs >"$WEB_LOG" 2>&1) &
WEB_PID=$!

# --- API -------------------------------------------------------------------
if warte_auf "http://127.0.0.1:$API_PORT_TEST/health"; then
  ok "API startet"
else
  schlecht "API startet nicht:"
  tail -12 "$API_LOG" >&2
  exit 1
fi

case "$(hole "http://127.0.0.1:$API_PORT_TEST/health")" in
  200*) ok "API /health antwortet" ;;
  *)    schlecht "API /health: $(hole "http://127.0.0.1:$API_PORT_TEST/health")" ;;
esac

# `/ready` antwortet bewusst mit 503, solange kein Fahrplan importiert ist —
# das ist keine Störung, sondern die ehrliche Auskunft „noch nicht bereit".
# Entscheidend ist der Zustand der einzelnen Komponenten.
BEREIT=$(hole "http://127.0.0.1:$API_PORT_TEST/ready")
case "$BEREIT" in
  200*|503*) ok "API /ready antwortet" ;;
  *)         schlecht "API /ready: $BEREIT" ;;
esac
case "$BEREIT" in
  *'"component":"database","status":"OK"'*) ok "Datenbank aus Sicht der API in Ordnung" ;;
  *) schlecht "Die API erreicht die Datenbank nicht" ;;
esac

FAHRPLAN_FEHLT="nein"
case "$BEREIT" in
  *'"component":"gtfs_static","status":"OK"'*) ok "Fahrplandaten sind geladen" ;;
  *) FAHRPLAN_FEHLT="ja" ;;
esac

# --- Fahrplandaten ---------------------------------------------------------
SUCHE=$(hole "http://127.0.0.1:$API_PORT_TEST/v1/search?q=Bahnhof&limit=1")
case "$SUCHE" in
  *'"kind":"STOP"'*) ok "Haltestellensuche liefert Ergebnisse" ;;
  *NO_ACTIVE_FEED*)
    HINWEIS="ja"
    echo "  ! Noch kein Fahrplan importiert — die App zeigt bis dahin keine Fahrten." ;;
  200*'"results":[]'*)
    HINWEIS="ja"
    echo "  ! Suche ohne Treffer — ist der Fahrplan importiert?" ;;
  *) schlecht "Haltestellensuche: $SUCHE" ;;
esac

# --- PWA -------------------------------------------------------------------
if warte_auf "http://127.0.0.1:$WEB_PORT_TEST/map"; then
  ok "PWA startet"
else
  schlecht "PWA startet nicht:"
  tail -12 "$WEB_LOG" >&2
  exit 1
fi

for pfad in /map /manifest.webmanifest /sw.js; do
  case "$(hole "http://127.0.0.1:$WEB_PORT_TEST$pfad")" in
    200*) ok "PWA $pfad" ;;
    *)    schlecht "PWA $pfad: $(hole "http://127.0.0.1:$WEB_PORT_TEST$pfad")" ;;
  esac
done

# Ohne ein vollständiges Manifest gilt die PWA in keinem Browser als
# installierbar. Bewusst über einen JSON-Parser statt über Textsuche: die Datei
# ist eingerückt, `"display": "standalone"` enthält ein Leerzeichen — eine
# Textsuche nach `"display":"standalone"` schlüge fälschlich fehl.
MANIFEST_PRUEFUNG=$(node --input-type=module -e "
  const antwort = await fetch('http://127.0.0.1:$WEB_PORT_TEST/manifest.webmanifest');
  const m = await antwort.json();
  const fehlt = [];
  if (m.display !== 'standalone') fehlt.push('display=standalone');
  if (!m.name) fehlt.push('name');
  if (!m.short_name) fehlt.push('short_name');
  if (!m.start_url) fehlt.push('start_url');
  const groessen = new Set((m.icons ?? []).map((i) => i.sizes));
  if (!groessen.has('192x192')) fehlt.push('Icon 192x192');
  if (!groessen.has('512x512')) fehlt.push('Icon 512x512');
  console.log(fehlt.length === 0 ? 'VOLLSTAENDIG' : 'FEHLT ' + fehlt.join(', '));
" 2>&1 || echo "FEHLER")

case "$MANIFEST_PRUEFUNG" in
  VOLLSTAENDIG) ok "Manifest ist installierbar (Name, Startseite, Icons 192/512)" ;;
  FEHLT*)       schlecht "Manifest unvollständig — ${MANIFEST_PRUEFUNG#FEHLT }" ;;
  *)            schlecht "Manifest nicht lesbar: $MANIFEST_PRUEFUNG" ;;
esac

echo ""
if [ "$FEHLER" -eq 0 ]; then
  echo "  ${B}Selbsttest bestanden.${N}"
  if [ "${FAHRPLAN_FEHLT:-nein}" = "ja" ]; then
    echo "  Die Anwendung läuft, es fehlen aber die Fahrplandaten:"
    echo "      ./bin/import-gtfs.sh"
  fi
else
  echo "  ${B}Selbsttest: $FEHLER Prüfung(en) fehlgeschlagen.${N}" >&2
  exit 1
fi
