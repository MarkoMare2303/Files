import { z } from 'zod';
import { gtfsIdSchema, uuidSchema } from './common.js';
import { accountStatusSchema, localeSchema, userRoleSchema } from './enums.js';

export const profileSchema = z.object({
  id: uuidSchema,
  /** Pseudonym; wird bei Meldungen angezeigt. Nie E-Mail oder Klarname. */
  alias: z.string(),
  role: userRoleSchema,
  status: accountStatusSchema,
  locale: localeSchema,
  createdAt: z.string(),
  /**
   * Reputation wird bewusst NICHT als öffentlicher Score ausgeliefert (§20),
   * sondern nur als grobe Stufe für den Nutzer selbst.
   */
  reputationTier: z.enum(['NEW', 'ESTABLISHED', 'TRUSTED']),
  reportsCount: z.number().int().min(0),
  confirmedReportsCount: z.number().int().min(0),
});
export type Profile = z.infer<typeof profileSchema>;

/** Push-Kategorien (§24). Jede ist einzeln abschaltbar. */
export const notificationSettingsSchema = z.object({
  officialDisruptions: z.boolean(),
  delays: z.boolean(),
  highOccupancy: z.boolean(),
  vehicleIssues: z.boolean(),
  safety: z.boolean(),
  connectionAtRisk: z.boolean(),
  communityReports: z.boolean(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const userSettingsSchema = z.object({
  locale: localeSchema,
  theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']),
  notifications: notificationSettingsSchema,
  /** Einwilligung für Hintergrund-Standort (§23). Default false. */
  backgroundLocationConsent: z.boolean(),
  /** Einwilligung für datensparsame Produktanalytik (§61). Default false. */
  analyticsConsent: z.boolean(),
  /** Automatische Fahrtenerkennung aktiv. */
  autoTripDetection: z.boolean(),
  /** Nach eindeutiger Erkennung automatisch der Fahrt folgen (§25). */
  autoFollowDetectedTrip: z.boolean(),
  /** Reduzierte Animationen (§46). */
  reducedMotion: z.boolean(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const updateUserSettingsSchema = userSettingsSchema.partial().extend({
  notifications: notificationSettingsSchema.partial().optional(),
});
export type UpdateUserSettings = z.infer<typeof updateUserSettingsSchema>;

export const favoriteKindSchema = z.enum(['STOP', 'ROUTE', 'JOURNEY']);
export type FavoriteKind = z.infer<typeof favoriteKindSchema>;

export const favoriteSchema = z.object({
  id: uuidSchema,
  kind: favoriteKindSchema,
  label: z.string(),
  stopId: gtfsIdSchema.nullable(),
  routeId: gtfsIdSchema.nullable(),
  /** Für gespeicherte Verbindungen: Start/Ziel. */
  originStopId: gtfsIdSchema.nullable(),
  destinationStopId: gtfsIdSchema.nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});
export type Favorite = z.infer<typeof favoriteSchema>;

export const createFavoriteSchema = z
  .object({
    kind: favoriteKindSchema,
    label: z.string().trim().min(1).max(120),
    stopId: gtfsIdSchema.optional(),
    routeId: gtfsIdSchema.optional(),
    originStopId: gtfsIdSchema.optional(),
    destinationStopId: gtfsIdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'STOP' && !v.stopId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'stopId ist für kind=STOP erforderlich' });
    }
    if (v.kind === 'ROUTE' && !v.routeId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'routeId ist für kind=ROUTE erforderlich' });
    }
    if (v.kind === 'JOURNEY' && (!v.originStopId || !v.destinationStopId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'originStopId und destinationStopId sind für kind=JOURNEY erforderlich',
      });
    }
  });
export type CreateFavorite = z.infer<typeof createFavoriteSchema>;

export const registerDeviceSchema = z.object({
  /** Stabile, app-generierte Installations-ID (kein Hardware-Identifier, §21/§23). */
  installId: uuidSchema,
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().max(32),
  osVersion: z.string().max(64).optional(),
  /** Expo-Push-Token; optional, falls Push abgelehnt wurde. */
  pushToken: z.string().max(256).optional(),
});
export type RegisterDevice = z.infer<typeof registerDeviceSchema>;

/** DSGVO/DSG-Datenexport (§23). */
export const dataExportSchema = z.object({
  generatedAt: z.string(),
  profile: z.unknown(),
  settings: z.unknown(),
  reports: z.array(z.unknown()),
  votes: z.array(z.unknown()),
  favorites: z.array(z.unknown()),
  tripSessions: z.array(z.unknown()),
  devices: z.array(z.unknown()),
});
export type DataExport = z.infer<typeof dataExportSchema>;
