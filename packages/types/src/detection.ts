import { z } from 'zod';
import { gpsObservationSchema, gtfsIdSchema, serviceDateSchema, uuidSchema } from './common.js';
import { detectionMethodSchema, vehicleTypeSchema } from './enums.js';

/** Einzelne Teilbewertung des Confidence-Scores (§10). */
export const scoreComponentSchema = z.object({
  /** Rohwert 0..1 vor Gewichtung. */
  raw: z.number().min(0).max(1),
  /** Gewicht 0..1. */
  weight: z.number().min(0).max(1),
  /** raw * weight. */
  weighted: z.number().min(0).max(1),
  /** Kurze Begründung für Debug/Admin — nie in der Endnutzer-UI. */
  detail: z.string().optional(),
});
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

export const scoreBreakdownSchema = z.object({
  shapeDistance: scoreComponentSchema,
  timeCompatibility: scoreComponentSchema,
  directionCompatibility: scoreComponentSchema,
  speedCompatibility: scoreComponentSchema,
  stopSequence: scoreComponentSchema,
  realtimeCompatibility: scoreComponentSchema,
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const tripCandidateSchema = z.object({
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
  directionId: z.number().int().min(0).max(1).nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),

  /** 0..1, gerundet auf 3 Nachkommastellen. */
  confidence: z.number().min(0).max(1),
  breakdown: scoreBreakdownSchema,

  /** Distanz der Nutzerposition zur Streckenlinie in Metern. */
  distanceToShapeMeters: z.number().nullable(),
  previousStopId: gtfsIdSchema.nullable(),
  previousStopName: z.string().nullable(),
  nextStopId: gtfsIdSchema.nullable(),
  nextStopName: z.string().nullable(),
  /** Prognostizierte Ankunft am nächsten Halt (ISO). */
  nextStopArrival: z.string().nullable(),
  delaySeconds: z.number().int().nullable(),
  /** Fortschritt 0..1 entlang der Fahrt. */
  progress: z.number().min(0).max(1).nullable(),
});
export type TripCandidate = z.infer<typeof tripCandidateSchema>;

/**
 * Wie die App mit dem Ergebnis umgehen soll (§11).
 * Die Schwellen sind serverseitig konfigurierbar (`app_config`).
 */
export const detectionDecisionSchema = z.enum([
  /** confidence ≥ autoThreshold → Fahrt automatisch übernehmen. */
  'AUTO_SELECT',
  /** confidence im Bestätigungsband → „Bist du gerade hier unterwegs?" */
  'CONFIRM',
  /** darunter → Auswahlliste anzeigen. */
  'CHOOSE',
  /** Keine plausible Fahrt gefunden → manuelle Auswahl anbieten (§12). */
  'NONE',
]);
export type DetectionDecision = z.infer<typeof detectionDecisionSchema>;

export const tripDetectionRequestSchema = z.object({
  /**
   * Aktuelle Beobachtung plus optional bis zu 9 vorangegangene Punkte.
   * Mehr Punkte verbessern Richtungs-/Geschwindigkeitsbewertung deutlich.
   * Die Punkte werden nicht dauerhaft gespeichert (§23, §60).
   */
  observations: z.array(gpsObservationSchema).min(1).max(10),
  /** Nur Kandidaten dieser Fahrzeugtypen berücksichtigen (Client-Vorfilter). */
  vehicleTypes: z.array(vehicleTypeSchema).optional(),
  /** Suchradius in Metern; der Server begrenzt den Wert. */
  radiusMeters: z.number().int().min(100).max(5000).optional(),
  /** Maximale Anzahl zurückgegebener Kandidaten. */
  limit: z.number().int().min(1).max(10).default(5),
});
export type TripDetectionRequest = z.infer<typeof tripDetectionRequestSchema>;

export const tripDetectionResponseSchema = z.object({
  decision: detectionDecisionSchema,
  /** Nach Confidence absteigend sortiert. */
  candidates: z.array(tripCandidateSchema),
  /** Verwendete Schwellenwerte — damit der Client dieselbe Logik offline anwenden kann. */
  thresholds: z.object({
    auto: z.number().min(0).max(1),
    confirm: z.number().min(0).max(1),
  }),
  /** Serverzeit des Matchings (ISO). */
  evaluatedAt: z.string(),
});
export type TripDetectionResponse = z.infer<typeof tripDetectionResponseSchema>;

export const tripSessionSchema = z.object({
  id: uuidSchema,
  tripId: gtfsIdSchema,
  serviceDate: serviceDateSchema,
  routeId: gtfsIdSchema.nullable(),
  agencyId: gtfsIdSchema.nullable(),
  confidence: z.number().min(0).max(1),
  detectionMethod: detectionMethodSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** Push-Benachrichtigungen für diese Fahrt aktiv (§25 Smart Follow). */
  following: z.boolean(),
});
export type TripSession = z.infer<typeof tripSessionSchema>;

export const startTripSessionInputSchema = z.object({
  tripId: gtfsIdSchema,
  serviceDate: serviceDateSchema,
  confidence: z.number().min(0).max(1),
  detectionMethod: detectionMethodSchema,
  /** Optionaler Positionsnachweis; wird für die Plausibilitätsprüfung genutzt. */
  observation: gpsObservationSchema.optional(),
});
export type StartTripSessionInput = z.infer<typeof startTripSessionInputSchema>;
