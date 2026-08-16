import { z } from 'zod';
import { gtfsIdSchema, localizedTextSchema, serviceDateSchema, uuidSchema } from './common.js';
import {
  flagReasonSchema,
  infoSourceSchema,
  reportScopeSchema,
  reportStatusSchema,
  vehicleTypeSchema,
} from './enums.js';

/**
 * Meldungskategorie. Wird aus der DB geladen und ist administrativ erweiterbar (§2, §17, §32).
 * Der `key` ist stabil und wird im Client für Icons/Übersetzungen genutzt.
 */
export const reportCategorySchema = z.object({
  id: uuidSchema,
  key: z.string().min(2).max(64),
  label: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  /** Name eines Icons aus dem App-Icon-Set. */
  icon: z.string().max(64),
  /** Akzentfarbe als Hex, z. B. `#E4572E`. */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  /** Gruppierung im Melden-Sheet. */
  group: z.enum(['CAPACITY', 'DISRUPTION', 'VEHICLE', 'STATION', 'SAFETY', 'INFO', 'OTHER']),
  defaultScope: reportScopeSchema,
  /** Erlaubte Scopes; der Client darf nur aus dieser Liste wählen. */
  allowedScopes: z.array(reportScopeSchema).min(1),
  /** Lebensdauer in Sekunden (§17). */
  ttlSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30),
  /** Wenn true, verlängert sich die TTL bis zum planmässigen Fahrtende. */
  ttlUntilTripEnd: z.boolean(),
  /** Kategorie erfordert eine erkannte/gewählte Fahrt. */
  requiresTrip: z.boolean(),
  /** Kategorie geht direkt in die Moderations-Queue (z. B. Sicherheitsereignisse). */
  requiresModeration: z.boolean(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type ReportCategory = z.infer<typeof reportCategorySchema>;

/** Community-Meldung, wie sie an Clients ausgeliefert wird. */
export const reportSchema = z.object({
  id: uuidSchema,
  source: z.literal('COMMUNITY'),
  categoryKey: z.string(),
  categoryLabel: localizedTextSchema,
  categoryIcon: z.string(),
  categoryColor: z.string(),
  scope: reportScopeSchema,
  status: reportStatusSchema,

  agencyId: gtfsIdSchema.nullable(),
  routeId: gtfsIdSchema.nullable(),
  routeShortName: z.string().nullable(),
  tripId: gtfsIdSchema.nullable(),
  serviceDate: serviceDateSchema.nullable(),
  vehicleType: vehicleTypeSchema.nullable(),
  directionId: z.number().int().min(0).max(1).nullable(),

  stopId: gtfsIdSchema.nullable(),
  stopName: z.string().nullable(),
  nextStopId: gtfsIdSchema.nullable(),
  nextStopName: z.string().nullable(),

  /** Grob gerundete Position (≈100 m) — genügt für die Kartendarstellung (§15, §23). */
  lat: z.number().nullable(),
  lon: z.number().nullable(),

  message: z.string().nullable(),

  /** Trust Score 0–100 (§19). */
  confidence: z.number().int().min(0).max(100),
  upvotes: z.number().int().min(0),
  downvotes: z.number().int().min(0),
  /** Stimme des anfragenden Nutzers: 1, -1 oder null. */
  myVote: z.number().int().min(-1).max(1).nullable(),
  /** Wurde die Meldung vom anfragenden Nutzer selbst erstellt? */
  isMine: z.boolean(),
  /** Pseudonymer Autoren-Alias; niemals Klarname oder E-Mail. */
  authorAlias: z.string().nullable(),

  createdAt: z.string(),
  expiresAt: z.string(),
});
export type Report = z.infer<typeof reportSchema>;

/**
 * Eingabe zum Erstellen einer Meldung (§15).
 * Der Server ergänzt/überschreibt sicherheitsrelevante Felder (user_id, confidence,
 * expires_at, status) — Client-Angaben dazu werden ignoriert (§42).
 */
export const createReportInputSchema = z
  .object({
    categoryKey: z.string().min(2).max(64),
    scope: reportScopeSchema.optional(),

    /** Aktive Trip-Session; daraus leitet der Server trip/route/agency ab. */
    tripSessionId: uuidSchema.optional(),
    tripId: gtfsIdSchema.optional(),
    serviceDate: serviceDateSchema.optional(),
    stopId: gtfsIdSchema.optional(),
    nextStopId: gtfsIdSchema.optional(),

    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(10_000).optional(),
    speed: z.number().min(0).max(150).optional(),

    /** Optionaler Freitext. Länge hart begrenzt (§42). */
    message: z.string().trim().max(280).optional(),

    /** Idempotenzschlüssel für die Offline-Queue (§39). */
    clientReportId: uuidSchema.optional(),
    /** Erfassungszeitpunkt auf dem Gerät — wichtig für verzögert hochgeladene Meldungen. */
    observedAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((v) => v.tripSessionId || v.tripId || v.stopId || (v.lat !== undefined && v.lon !== undefined), {
    message:
      'Mindestens ein Bezug ist erforderlich: tripSessionId, tripId, stopId oder lat/lon.',
  });
export type CreateReportInput = z.infer<typeof createReportInputSchema>;

export const voteInputSchema = z.object({
  /** 1 = „Trifft zu", -1 = „Nicht mehr aktuell" (§18). */
  vote: z.union([z.literal(1), z.literal(-1)]),
});
export type VoteInput = z.infer<typeof voteInputSchema>;

export const flagInputSchema = z.object({
  reason: flagReasonSchema,
  note: z.string().trim().max(500).optional(),
});
export type FlagInput = z.infer<typeof flagInputSchema>;

/**
 * Gemeinsamer Feed aus offiziellen und Community-Meldungen.
 * Die Unterscheidung erfolgt über das diskriminierende Feld `source` (§7).
 */
export const feedItemSchema = z.discriminatedUnion('source', [
  reportSchema,
  z.object({
    source: z.literal('OFFICIAL'),
    id: z.string(),
    severity: z.enum(['UNKNOWN', 'INFO', 'WARNING', 'SEVERE']),
    header: localizedTextSchema,
    description: localizedTextSchema.nullable(),
    url: z.string().nullable(),
    cause: z.string().nullable(),
    effect: z.string().nullable(),
    affectedRouteIds: z.array(gtfsIdSchema),
    affectedStopIds: z.array(gtfsIdSchema),
    activeFrom: z.string().nullable(),
    activeUntil: z.string().nullable(),
    updatedAt: z.string(),
  }),
]);
export type FeedItem = z.infer<typeof feedItemSchema>;

export const reportQuerySchema = z.object({
  tripId: gtfsIdSchema.optional(),
  serviceDate: serviceDateSchema.optional(),
  routeId: gtfsIdSchema.optional(),
  stopId: gtfsIdSchema.optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radiusMeters: z.coerce.number().int().min(50).max(50_000).default(3000),
  includeOfficial: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export { infoSourceSchema };
