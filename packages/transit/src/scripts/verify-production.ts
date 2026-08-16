#!/usr/bin/env node
import { transitEnvSchema, loadEnvFiles, parseEnv } from '@swissov/config';
import { httpRequest, HttpError } from '../http.js';

/**
 * Produktionsprüfung der externen Datenquellen.
 *
 *     pnpm gtfs:verify-production
 *
 * Warum es dieses Werkzeug gibt: Die Entwicklungsumgebung, in der dieses
 * Projekt entstanden ist, erreicht `opentransportdata.swiss` nicht — der
 * ausgehende Proxy beantwortet die Anfragen mit HTTP 403. Sicherheits- oder
 * Netzwerkrichtlinien zu umgehen kam nicht in Frage. Stattdessen prüft dieses
 * Skript alles, was für den Produktivbetrieb zählt, dort, wo es hingehört:
 * auf einer Maschine mit echtem Netzzugang und echten Zugangsdaten.
 *
 * Geprüft wird:
 *   1. Sind die Zugangsdaten gesetzt und formal plausibel?
 *   2. Ist der GTFS-Static-Datensatz erreichbar? Wie gross ist er?
 *   3. Antwortet der GTFS-RT-Endpunkt für TripUpdates mit Protocol Buffers?
 *   4. Antwortet der GTFS-RT-Endpunkt für ServiceAlerts?
 *   5. Antwortet der OJP-Endpunkt auf eine minimale Anfrage?
 *
 * Es wird NICHTS importiert und NICHTS in die Datenbank geschrieben. Das
 * Skript ist ausdrücklich gefahrlos und kann jederzeit laufen — auch als
 * Bereitschaftsprüfung in einem Monitoring.
 *
 * Rückgabewert: 0 wenn alle PFLICHT-Prüfungen bestanden sind, sonst 1.
 */

interface CheckResult {
  name: string;
  required: boolean;
  ok: boolean;
  detail: string;
  hint?: string;
}

const results: CheckResult[] = [];

function record(result: CheckResult): void {
  results.push(result);
  const mark = result.ok ? '✓' : result.required ? '✗' : '○';
  console.log(`${mark} ${result.name}`);
  console.log(`    ${result.detail}`);
  if (!result.ok && result.hint) console.log(`    → ${result.hint}`);
}

/** Kürzt einen Schlüssel für die Ausgabe — nie den vollständigen Wert loggen. */
function maskSecret(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} Zeichen)`;
}

function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    return `HTTP ${error.status}${error.bodySnippet ? ` — ${error.bodySnippet.slice(0, 120)}` : ''}`;
  }
  if (error instanceof Error) {
    // Netzwerkfehler bringen den eigentlichen Grund im `cause` mit.
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}

/** Deutet typische Fehlerbilder, statt nur den Statuscode zu wiederholen. */
function hintFor(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401) return 'Der API-Schlüssel wird abgelehnt. Ist er noch gültig?';
    if (error.status === 403) {
      return (
        'Zugriff verweigert. Entweder fehlt die Freischaltung für diesen Datensatz, ' +
        'oder ein Proxy/eine Firewall blockiert die Verbindung. In Container-Umgebungen ' +
        'ist Letzteres der häufigere Grund.'
      );
    }
    if (error.status === 404) return 'Die URL stimmt nicht mehr. Datensatz-ID im Portal prüfen.';
    if (error.status === 429) return 'Zu viele Anfragen. Später erneut versuchen.';
    if (error.status >= 500) return 'Der Anbieter hat gerade eine Störung. Später erneut versuchen.';
  }
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS-Auflösung fehlgeschlagen.';
  if (code === 'ECONNREFUSED') return 'Verbindung abgelehnt — Proxy oder Firewall?';
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return 'TLS-Zertifikat nicht überprüfbar. Fehlt ein Firmen-Root-Zertifikat im Trust Store?';
  }
  return 'Netzwerkverbindung und Zugangsdaten prüfen.';
}

/**
 * Erste Bytes eines Protocol-Buffer-Feeds plausibilisieren.
 *
 * Ein GTFS-RT-`FeedMessage` beginnt immer mit Feld 1 (`header`), also dem
 * Byte 0x0A. Kommt stattdessen `{` oder `<`, hat der Server eine Fehlerseite
 * geliefert — mit HTTP 200, wie es leider vorkommt.
 */
function looksLikeProtobuf(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x0a;
}

async function checkGtfsStatic(url: string, apiKey: string | undefined): Promise<void> {
  const name = 'GTFS-Static (Fahrplan-Datensatz)';
  try {
    // HEAD spart den Download der kompletten ZIP-Datei (mehrere hundert MB).
    const response = await httpRequest(url, {
      method: 'HEAD',
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      timeoutMs: 30_000,
      retries: 1,
    });

    const size = Number(response.headers.get('content-length') ?? 0);
    const modified = response.headers.get('last-modified');
    const sizeMb = size > 0 ? `${(size / 1024 / 1024).toFixed(1)} MB` : 'Grösse unbekannt';

    record({
      name,
      required: true,
      ok: true,
      detail: `erreichbar — ${sizeMb}${modified ? `, zuletzt geändert ${modified}` : ''}`,
    });

    if (size > 0 && size < 1024 * 1024) {
      console.log(
        '    ⚠ Der Datensatz ist auffällig klein. Ein Schweizer Gesamtfahrplan liegt bei ' +
          'mehreren hundert MB — zeigt die URL wirklich auf den vollständigen Datensatz?',
      );
    }
  } catch (error) {
    record({
      name,
      required: true,
      ok: false,
      detail: describeError(error),
      hint: hintFor(error),
    });
  }
}

async function checkRealtimeFeed(
  name: string,
  url: string | undefined,
  apiKey: string | undefined,
): Promise<void> {
  if (!url) {
    record({ name, required: false, ok: false, detail: 'keine URL konfiguriert — übersprungen' });
    return;
  }
  if (!apiKey) {
    record({
      name,
      required: false,
      ok: false,
      detail: 'kein API-Schlüssel gesetzt — übersprungen',
      hint: 'OPENTRANSPORTDATA_API_KEY setzen.',
    });
    return;
  }

  try {
    const response = await httpRequest(url, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/x-protobuf' },
      timeoutMs: 30_000,
      retries: 1,
    });

    const buffer = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'unbekannt';

    if (!looksLikeProtobuf(buffer)) {
      const preview = new TextDecoder().decode(buffer.slice(0, 120)).replace(/\s+/g, ' ');
      record({
        name,
        required: true,
        ok: false,
        detail: `HTTP 200, aber keine Protocol-Buffer-Nutzlast (${contentType}, ${buffer.length} Byte)`,
        hint: `Der Server hat etwas anderes geliefert: „${preview}"`,
      });
      return;
    }

    record({
      name,
      required: true,
      ok: true,
      detail: `${(buffer.length / 1024).toFixed(0)} KB Protocol Buffers (${contentType})`,
    });
  } catch (error) {
    record({ name, required: true, ok: false, detail: describeError(error), hint: hintFor(error) });
  }
}

async function checkOjp(url: string | undefined, apiKey: string | undefined): Promise<void> {
  const name = 'OJP 2.0 (Verbindungssuche)';
  if (!url || !apiKey) {
    record({
      name,
      required: false,
      ok: false,
      detail: 'nicht konfiguriert — die App nutzt die Fahrplan-Direktsuche als Ersatz',
      hint: 'OJP_ENDPOINT_URL und OJP_API_KEY setzen, um OJP zu aktivieren.',
    });
    return;
  }

  // Kleinstmögliche gültige Anfrage: Zürich HB → Bern, jetzt.
  const now = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:RequestorRef>swissov-verify</siri:RequestorRef>
      <OJPTripRequest>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <Origin><PlaceRef><StopPlaceRef>8503000</StopPlaceRef><Name><Text>Zürich HB</Text></Name></PlaceRef></Origin>
        <Destination><PlaceRef><StopPlaceRef>8507000</StopPlaceRef><Name><Text>Bern</Text></Name></PlaceRef></Destination>
        <Params><NumberOfResults>1</NumberOfResults></Params>
      </OJPTripRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

  try {
    const response = await httpRequest(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/xml' },
      body,
      timeoutMs: 30_000,
      retries: 1,
    });

    const xml = await response.text();
    const hasTrips = xml.includes('<Trip>') || xml.includes(':Trip>');

    record({
      name,
      required: false,
      ok: true,
      detail: hasTrips
        ? `antwortet mit Verbindungen (${(xml.length / 1024).toFixed(0)} KB XML)`
        : `antwortet (${(xml.length / 1024).toFixed(0)} KB XML), aber ohne Verbindung — ` +
          'formal in Ordnung, inhaltlich prüfen',
    });
  } catch (error) {
    record({ name, required: false, ok: false, detail: describeError(error), hint: hintFor(error) });
  }
}

async function main(): Promise<void> {
  loadEnvFiles();
  const env = parseEnv(transitEnvSchema);

  console.log('Produktionsprüfung der externen Datenquellen');
  console.log('═'.repeat(60));
  console.log('');

  // --- 1. Zugangsdaten ------------------------------------------------------
  const apiKey = env.OPENTRANSPORTDATA_API_KEY;
  record({
    name: 'Zugangsdaten opentransportdata.swiss',
    required: true,
    ok: Boolean(apiKey),
    detail: apiKey ? `gesetzt: ${maskSecret(apiKey)}` : 'OPENTRANSPORTDATA_API_KEY ist nicht gesetzt',
    hint: 'Schlüssel unter https://opentransportdata.swiss beantragen und in .env eintragen.',
  });
  console.log('');

  // --- 2. Statischer Fahrplan ----------------------------------------------
  await checkGtfsStatic(env.GTFS_STATIC_URL, apiKey);
  console.log('');

  // --- 3./4. Echtzeitdaten --------------------------------------------------
  await checkRealtimeFeed('GTFS-RT TripUpdates (Verspätungen)', env.GTFS_RT_TRIP_UPDATES_URL, apiKey);
  console.log('');
  await checkRealtimeFeed('GTFS-RT ServiceAlerts (offizielle Störungen)', env.GTFS_RT_SERVICE_ALERTS_URL, apiKey);
  console.log('');

  // --- 5. Verbindungssuche --------------------------------------------------
  await checkOjp(env.OJP_ENDPOINT_URL, env.OJP_API_KEY);
  console.log('');

  // --- Ergebnis -------------------------------------------------------------
  const requiredFailures = results.filter((result) => result.required && !result.ok);
  const optionalFailures = results.filter((result) => !result.required && !result.ok);

  console.log('═'.repeat(60));
  console.log(
    `${results.filter((r) => r.ok).length} von ${results.length} Prüfungen bestanden` +
      (optionalFailures.length > 0 ? `, ${optionalFailures.length} optional übersprungen` : ''),
  );

  if (requiredFailures.length === 0) {
    console.log('');
    console.log('✓ Alle Pflichtprüfungen bestanden.');
    console.log('  Nächster Schritt — den Fahrplan tatsächlich importieren:');
    console.log('');
    console.log('      pnpm db:migrate');
    console.log('      pnpm gtfs:import');
    console.log('');
    console.log('  Der Import dauert je nach Maschine 10–40 Minuten und braucht');
    console.log('  rund 8 GB freien Speicher in der Datenbank.');
    return;
  }

  console.log('');
  console.log('✗ Nicht bereit für den Produktivbetrieb:');
  for (const failure of requiredFailures) {
    console.log(`  • ${failure.name}: ${failure.detail}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✗ Unerwarteter Fehler: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
