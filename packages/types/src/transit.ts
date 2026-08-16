import { z } from 'zod';
import { coordinatesSchema, gtfsIdSchema, localizedTextSchema, serviceDateSchema } from './common.js';
import { alertSeveritySchema, vehicleTypeSchema } from './enums.js';

export const agencySchema = z.object({
  agencyId: gtfsIdSchema,
  name: z.string(),
  url: z.string().nullable(),
  timezone: z.string(),
});
export type Agency = z.infer<typeof agencySchema>;

export const stopSchema = z.object({
  stopId: gtfsIdSchema,
  name: z.string(),
  /** Offizieller Haltestellencode (in CH häufig die DiDok-/UIC-Nummer). */
  code: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  /** 0 = Haltekante/Stop, 1 = Station, 2 = Eingang, 3 = generischer Knoten, 4 = Boarding Area. */
  locationType: z.number().int().min(0).max(4),
  parentStation: gtfsIdSchema.nullable(),
  platformCode: z.string().nullable(),
  /** 0 = unbekannt, 1 = zugänglich, 2 = nicht zugänglich. */
  wheelchairBoarding: z.number().int().min(0).max(2),
  /** Distanz zur Anfrageposition in Metern — nur bei `/stops/nearby` gesetzt. */
  distanceMeters: z.number().nullable().optional(),
  /** Verkehrsmittel, die diese Haltestelle bedienen. */
  vehicleTypes: z.array(vehicleTypeSchema).optional(),
});
export type Stop = z.infer<typeof stopSchema>;

export const routeSchema = z.object({
  routeId: gtfsIdSchema,
  agencyId: gtfsIdSchema.nullable(),
  agencyName: z.string().nullable(),
  shortName: z.string().nullable(),
  longName: z.string().nullable(),
  routeType: z.number().int(),
  vehicleType: vehicleTypeSchema,
  color: z.string().nullable(),
  textColor: z.string().nullable(),
});
export type Route = z.infer<typeof routeSchema>;

/** Ein Halt innerhalb einer Fahrt inkl. Echtzeit-Prognose. */
export const tripStopSchema = z.object({
  stopId: gtfsIdSchema,
  stopName: z.string(),
  stopSequence: z.number().int(),
  lat: z.number(),
  lon: z.number(),
  platformCode: z.string().nullable(),
  /** Planmässige Ankunft als ISO-Zeitstempel (aufgelöst über den Betriebstag). */
  scheduledArrival: z.string().nullable(),
  scheduledDeparture: z.string().nullable(),
  /** Prognostizierte Zeiten aus GTFS-RT; `null`, wenn keine Echtzeitdaten vorliegen. */
  realtimeArrival: z.string().nullable(),
  realtimeDeparture: z.string().nullable(),
  /** Verspätung in Sekunden (positiv = später). `null` = keine Echtzeitdaten. */
  delaySeconds: z.number().int().nullable(),
  /** Aus GTFS-RT: Halt entfällt. */
  skipped: z.boolean(),
});
export type TripStop = z.infer<typeof tripStopSchema>;

export const tripSchema = z.object({
  tripId: gtfsIdSchema,
  serviceDate: serviceDateSchema,
  routeId: gtfsIdSchema,
  routeShortName: z.string().nullable(),
  routeLongName: z.string().nullable(),
  routeColor: z.string().nullable(),
  agencyId: gtfsIdSchema.nullable(),
  agencyName: z.string().nullable(),
  vehicleType: vehicleTypeSchema,
  headsign: z.string().nullable(),
  /** 0 oder 1 gemäss GTFS; `null` wenn im Feed nicht gesetzt. */
  directionId: z.number().int().min(0).max(1).nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  /** Gesamtverspätung der Fahrt in Sekunden aus GTFS-RT. */
  delaySeconds: z.number().int().nullable(),
  cancelled: z.boolean(),
  stops: z.array(tripStopSchema),
});
export type Trip = z.infer<typeof tripSchema>;

/**
 * Geschätzte Fahrzeugposition. WICHTIG (§13): Diese Position ist aus Fahrplan +
 * Streckenverlauf + Echtzeitverspätung interpoliert und **keine** offizielle GPS-Position.
 * `isEstimated` ist deshalb literal `true` und muss in der UI gekennzeichnet werden.
 */
export const estimatedVehiclePositionSchema = z.object({
  tripId: gtfsIdSchema,
  serviceDate: serviceDateSchema,
  lat: z.number(),
  lon: z.number(),
  bearing: z.number().nullable(),
  isEstimated: z.literal(true),
  /** Woraus die Schätzung stammt — für die UI-Kennzeichnung. */
  basis: z.enum(['SCHEDULE', 'SCHEDULE_PLUS_REALTIME']),
  asOf: z.string(),
});
export type EstimatedVehiclePosition = z.infer<typeof estimatedVehiclePositionSchema>;

export const departureSchema = z.object({
  tripId: gtfsIdSchema,
  serviceDate: serviceDateSchema,
  stopId: gtfsIdSchema,
  stopName: z.string(),
  platformCode: z.string().nullable(),
  routeId: gtfsIdSchema,
  routeShortName: z.string().nullable(),
  routeColor: z.string().nullable(),
  vehicleType: vehicleTypeSchema,
  agencyName: z.string().nullable(),
  headsign: z.string().nullable(),
  directionId: z.number().int().min(0).max(1).nullable(),
  scheduledDeparture: z.string(),
  realtimeDeparture: z.string().nullable(),
  delaySeconds: z.number().int().nullable(),
  cancelled: z.boolean(),
});
export type Departure = z.infer<typeof departureSchema>;

/** Offizielle Störungsmeldung (GTFS-RT ServiceAlert). Quelle: `OFFICIAL`. */
export const serviceAlertSchema = z.object({
  id: z.string(),
  source: z.literal('OFFICIAL'),
  severity: alertSeveritySchema,
  cause: z.string().nullable(),
  effect: z.string().nullable(),
  header: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  url: z.string().nullable(),
  activeFrom: z.string().nullable(),
  activeUntil: z.string().nullable(),
  affectedRouteIds: z.array(gtfsIdSchema),
  affectedStopIds: z.array(gtfsIdSchema),
  affectedTripIds: z.array(gtfsIdSchema),
  affectedAgencyIds: z.array(gtfsIdSchema),
  updatedAt: z.string(),
});
export type ServiceAlert = z.infer<typeof serviceAlertSchema>;

// --- Journey Planning (OJP-Abstraktion, §8) ---------------------------------

export const journeyPlaceSchema = z.object({
  stopId: gtfsIdSchema.nullable(),
  name: z.string(),
  platformCode: z.string().nullable(),
  coordinates: coordinatesSchema.nullable(),
});
export type JourneyPlace = z.infer<typeof journeyPlaceSchema>;

export const journeyLegSchema = z.object({
  mode: z.enum(['TRANSIT', 'WALK', 'TRANSFER']),
  vehicleType: vehicleTypeSchema.nullable(),
  routeShortName: z.string().nullable(),
  routeLongName: z.string().nullable(),
  agencyName: z.string().nullable(),
  headsign: z.string().nullable(),
  tripId: gtfsIdSchema.nullable(),
  origin: journeyPlaceSchema,
  destination: journeyPlaceSchema,
  departure: z.string(),
  arrival: z.string(),
  departureDelaySeconds: z.number().int().nullable(),
  arrivalDelaySeconds: z.number().int().nullable(),
  durationSeconds: z.number().int(),
  intermediateStops: z.array(journeyPlaceSchema).default([]),
  cancelled: z.boolean().default(false),
});
export type JourneyLeg = z.infer<typeof journeyLegSchema>;

export const journeySchema = z.object({
  id: z.string(),
  departure: z.string(),
  arrival: z.string(),
  durationSeconds: z.number().int(),
  transfers: z.number().int().min(0),
  legs: z.array(journeyLegSchema),
});
export type Journey = z.infer<typeof journeySchema>;
