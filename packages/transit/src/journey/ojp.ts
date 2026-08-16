import { vehicleTypeFromRouteType, type Journey, type JourneyLeg, type JourneyPlace } from '@swissov/types';
import { XMLParser } from 'fast-xml-parser';
import { httpRequest } from '../http.js';
import {
  JourneyPlannerUnavailableError,
  type JourneyPlannerProvider,
  type JourneySearchRequest,
  type JourneySearchResult,
} from './provider.js';

/**
 * Open Journey Planner (OJP 2.0) — Provider für die Verbindungssuche.
 *
 * Der Endpunkt von opentransportdata.swiss erwartet ein SIRI/OJP-XML-Dokument
 * per POST und antwortet ebenfalls mit XML. Der API-Key wird ausschliesslich
 * serverseitig verwendet.
 */

export interface OjpProviderOptions {
  endpointUrl: string;
  apiKey: string | undefined;
  requestorRef: string;
  timeoutMs?: number;
}

const OJP_MODE_TO_ROUTE_TYPE: Record<string, number> = {
  rail: 2,
  train: 2,
  metro: 1,
  tram: 0,
  bus: 3,
  coach: 3,
  water: 4,
  telecabin: 6,
  funicular: 7,
  trolleyBus: 11,
  unknown: 3,
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** ISO-8601 in UTC, wie von OJP erwartet. */
function isoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildTripRequestXml(
  request: JourneySearchRequest,
  requestorRef: string,
  now: Date = new Date(),
): string {
  const timestamp = isoUtc(now);
  const depArr = isoUtc(request.at);
  const results = request.results ?? 5;
  const language = (request.locale ?? 'de').slice(0, 2);
  const timeTag = request.timeMode === 'ARRIVAL' ? 'Arr' : 'Dep';

  return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:ServiceRequestContext>
        <siri:Language>${escapeXml(language)}</siri:Language>
      </siri:ServiceRequestContext>
      <siri:RequestTimestamp>${timestamp}</siri:RequestTimestamp>
      <siri:RequestorRef>${escapeXml(requestorRef)}</siri:RequestorRef>
      <OJPTripRequest>
        <siri:RequestTimestamp>${timestamp}</siri:RequestTimestamp>
        <Origin>
          <PlaceRef>
            <StopPlaceRef>${escapeXml(request.originStopId)}</StopPlaceRef>
          </PlaceRef>
          <${timeTag}ArrTime>${depArr}</${timeTag}ArrTime>
        </Origin>
        <Destination>
          <PlaceRef>
            <StopPlaceRef>${escapeXml(request.destinationStopId)}</StopPlaceRef>
          </PlaceRef>
        </Destination>
        <Params>
          <NumberOfResults>${results}</NumberOfResults>
          <IncludeTrackSections>false</IncludeTrackSections>
          <IncludeIntermediateStops>true</IncludeIntermediateStops>
          <UseRealtimeData>explanatory</UseRealtimeData>
        </Params>
      </OJPTripRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['Trip', 'TripLeg', 'Leg', 'CallAtStop', 'Result'].includes(name),
});

type XmlNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: unknown): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node.length > 0 ? node : null;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const record = node as XmlNode;
    if (typeof record.Text === 'string') return record.Text;
    if (record.Text && typeof record.Text === 'object') {
      const inner = (record.Text as XmlNode).Text;
      if (typeof inner === 'string') return inner;
    }
    if (typeof record['#text'] === 'string') return record['#text'] as string;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toPlace(node: XmlNode | undefined): JourneyPlace {
  if (!node) return { stopId: null, name: 'Unbekannt', platformCode: null, coordinates: null };
  const stopId =
    text(node.StopPointRef) ?? text(node.StopPlaceRef) ?? text((node.StopPlace as XmlNode)?.StopPlaceRef);
  const name =
    text(node.StopPointName) ??
    text(node.NameSuffix) ??
    text((node.StopPlace as XmlNode)?.StopPlaceName) ??
    text(node.LocationName) ??
    'Unbekannt';
  const platform = text(node.PlannedQuay) ?? text(node.EstimatedQuay) ?? text(node.PlannedBay);

  const geo = node.GeoPosition as XmlNode | undefined;
  const lat = geo ? Number(text(geo.Latitude)) : Number.NaN;
  const lon = geo ? Number(text(geo.Longitude)) : Number.NaN;

  return {
    stopId: stopId ?? null,
    name,
    platformCode: platform ?? null,
    coordinates:
      Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
  };
}

function callTimes(call: XmlNode | undefined, kind: 'ServiceArrival' | 'ServiceDeparture') {
  const node = call?.[kind] as XmlNode | undefined;
  const planned = parseDate(node?.TimetabledTime);
  const estimated = parseDate(node?.EstimatedTime);
  const delaySeconds =
    planned && estimated ? Math.round((estimated.getTime() - planned.getTime()) / 1000) : null;
  return { planned, estimated, effective: estimated ?? planned, delaySeconds };
}

/** Wandelt eine geparste OJP-Antwort in unsere `Journey`-Struktur. */
export function parseTripResponse(xml: string): Journey[] {
  const document = parser.parse(xml) as XmlNode;
  const ojp = (document.OJP ?? document) as XmlNode;
  const delivery = findFirst(ojp, 'OJPTripDelivery');
  if (!delivery) return [];

  const results = asArray(delivery.TripResult as XmlNode | XmlNode[] | undefined);
  const journeys: Journey[] = [];

  for (const [index, result] of results.entries()) {
    const trip = (result.Trip ?? result) as XmlNode;
    const tripNode = Array.isArray(trip) ? (trip[0] as XmlNode) : trip;
    if (!tripNode) continue;

    const legs: JourneyLeg[] = [];
    for (const legNode of asArray(tripNode.Leg as XmlNode | XmlNode[] | undefined)) {
      const leg = parseLeg(legNode);
      if (leg) legs.push(leg);
    }
    if (legs.length === 0) continue;

    const departure = legs[0]!.departure;
    const arrival = legs[legs.length - 1]!.arrival;
    const durationSeconds = Math.max(
      0,
      Math.round((new Date(arrival).getTime() - new Date(departure).getTime()) / 1000),
    );

    journeys.push({
      id: text(result.Id) ?? text(tripNode.Id) ?? `ojp-${index}`,
      departure,
      arrival,
      durationSeconds,
      transfers: Math.max(0, legs.filter((l) => l.mode === 'TRANSIT').length - 1),
      legs,
    });
  }

  return journeys;
}

function parseLeg(node: XmlNode): JourneyLeg | null {
  const timedLeg = node.TimedLeg as XmlNode | undefined;
  const transferLeg = (node.TransferLeg ?? node.ContinuousLeg) as XmlNode | undefined;

  if (timedLeg) {
    const boardNode = timedLeg.LegBoard as XmlNode | undefined;
    const alightNode = timedLeg.LegAlight as XmlNode | undefined;
    const service = timedLeg.Service as XmlNode | undefined;

    const board = callTimes(boardNode, 'ServiceDeparture');
    const alight = callTimes(alightNode, 'ServiceArrival');
    if (!board.effective || !alight.effective) return null;

    const modeNode = service?.Mode as XmlNode | undefined;
    const modeName = (text(modeNode?.PtMode) ?? 'unknown').toLowerCase();

    const intermediate: JourneyPlace[] = asArray(
      timedLeg.LegIntermediate as XmlNode | XmlNode[] | undefined,
    ).map((entry) => toPlace(entry));

    return {
      mode: 'TRANSIT',
      // OJP liefert eine Modus-Bezeichnung; sie wird auf denselben
      // Fahrzeugtyp-Enum abgebildet, den auch die GTFS-Pfade verwenden.
      vehicleType: vehicleTypeFromRouteType(OJP_MODE_TO_ROUTE_TYPE[modeName] ?? null),
      routeShortName:
        text(service?.PublishedServiceName) ?? text(service?.PublishedLineName) ?? text(service?.LineRef),
      routeLongName: text(service?.DestinationText) ?? null,
      agencyName: text(service?.OperatorRef) ?? null,
      headsign: text(service?.DestinationText) ?? null,
      tripId: text(service?.JourneyRef) ?? null,
      origin: toPlace(boardNode),
      destination: toPlace(alightNode),
      departure: board.effective.toISOString(),
      arrival: alight.effective.toISOString(),
      departureDelaySeconds: board.delaySeconds,
      arrivalDelaySeconds: alight.delaySeconds,
      durationSeconds: Math.round((alight.effective.getTime() - board.effective.getTime()) / 1000),
      intermediateStops: intermediate,
      cancelled: text(timedLeg.Cancelled) === 'true',
    };
  }

  if (transferLeg) {
    const start = parseDate(transferLeg.TimeWindowStart) ?? parseDate(transferLeg.StartTime);
    const end = parseDate(transferLeg.TimeWindowEnd) ?? parseDate(transferLeg.EndTime);
    const durationText = text(transferLeg.Duration);
    const durationSeconds = durationText ? parseIso8601Duration(durationText) : null;
    if (!start && !end && durationSeconds === null) return null;

    const from = toPlace(transferLeg.LegStart as XmlNode | undefined);
    const to = toPlace(transferLeg.LegEnd as XmlNode | undefined);
    const departure = start ?? new Date();
    const arrival = end ?? new Date(departure.getTime() + (durationSeconds ?? 0) * 1000);

    return {
      mode: 'WALK',
      vehicleType: null,
      routeShortName: null,
      routeLongName: null,
      agencyName: null,
      headsign: null,
      tripId: null,
      origin: from,
      destination: to,
      departure: departure.toISOString(),
      arrival: arrival.toISOString(),
      departureDelaySeconds: null,
      arrivalDelaySeconds: null,
      durationSeconds: durationSeconds ?? Math.round((arrival.getTime() - departure.getTime()) / 1000),
      intermediateStops: [],
      cancelled: false,
    };
  }

  return null;
}

/** ISO-8601-Dauer (`PT5M`, `PT1H20M`) in Sekunden. */
export function parseIso8601Duration(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

/**
 * Sucht rekursiv das erste Vorkommen eines Elements.
 *
 * Der Namensraum-Präfix ist bereits entfernt, die Verschachtelungstiefe der
 * OJP-Antwort variiert aber je nach Anbieter. Textknoten (Strings) müssen
 * dabei übersprungen werden — `in` funktioniert auf ihnen nicht.
 */
function findFirst(node: unknown, key: string): XmlNode | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirst(item, key);
      if (found) return found;
    }
    return null;
  }
  const record = node as XmlNode;
  if (key in record) {
    const value = record[key];
    const first = Array.isArray(value) ? value[0] : value;
    return first && typeof first === 'object' ? (first as XmlNode) : null;
  }
  for (const value of Object.values(record)) {
    const found = findFirst(value, key);
    if (found) return found;
  }
  return null;
}

export class OjpJourneyPlannerProvider implements JourneyPlannerProvider {
  readonly name = 'ojp';

  constructor(private readonly options: OjpProviderOptions) {}

  isAvailable(): boolean {
    return Boolean(this.options.apiKey);
  }

  async search(request: JourneySearchRequest): Promise<JourneySearchResult> {
    if (!this.options.apiKey) {
      throw new JourneyPlannerUnavailableError(
        'OJP_API_KEY ist nicht gesetzt. Die Verbindungssuche über Open Journey Planner ist ' +
          'deshalb deaktiviert (siehe .env.example).',
      );
    }

    const body = buildTripRequestXml(request, this.options.requestorRef);
    const response = await httpRequest(this.options.endpointUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/xml; charset=utf-8',
        accept: 'application/xml',
      },
      body,
      timeoutMs: this.options.timeoutMs ?? 20_000,
      retries: 1,
    });

    const xml = await response.text();
    const journeys = parseTripResponse(xml);
    return { journeys, provider: this.name, limitations: [] };
  }

  async healthcheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.options.apiKey) {
      return { ok: false, message: 'OJP_API_KEY fehlt' };
    }
    try {
      // Leichtgewichtige Anfrage: derselbe Halt als Start und Ziel.
      await this.search({
        originStopId: '8503000',
        destinationStopId: '8500010',
        at: new Date(),
        timeMode: 'DEPARTURE',
        results: 1,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
