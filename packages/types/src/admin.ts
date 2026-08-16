import { z } from 'zod';
import { gtfsIdSchema, localizedTextSchema, uuidSchema } from './common.js';
import {
  accountStatusSchema,
  gtfsImportStatusSchema,
  moderationActionTypeSchema,
  reportScopeSchema,
  reportStatusSchema,
  userRoleSchema,
} from './enums.js';

export const adminDashboardSchema = z.object({
  users: z.object({
    total: z.number().int(),
    activeLast7Days: z.number().int(),
    newLast7Days: z.number().int(),
    suspended: z.number().int(),
    shadowFlagged: z.number().int(),
  }),
  reports: z.object({
    today: z.number().int(),
    active: z.number().int(),
    last7Days: z.number().int(),
    pendingModeration: z.number().int(),
    removedLast7Days: z.number().int(),
    /** Anteil entfernter/geflaggter Meldungen an allen Meldungen der letzten 7 Tage. */
    spamRatePercent: z.number(),
    byCategory: z.array(
      z.object({ categoryKey: z.string(), label: localizedTextSchema, count: z.number().int() }),
    ),
  }),
  transit: z.object({
    activeImport: z
      .object({
        id: uuidSchema,
        feedVersion: z.string().nullable(),
        status: gtfsImportStatusSchema,
        activatedAt: z.string().nullable(),
        stops: z.number().int(),
        routes: z.number().int(),
        trips: z.number().int(),
        stopTimes: z.number().int(),
      })
      .nullable(),
    lastImportStatus: gtfsImportStatusSchema.nullable(),
    lastImportError: z.string().nullable(),
  }),
  health: z.array(
    z.object({
      component: z.string(),
      status: z.enum(['OK', 'DEGRADED', 'DOWN', 'UNKNOWN']),
      lastSuccessAt: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

export const adminReportFilterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  categoryKey: z.string().optional(),
  agencyId: gtfsIdSchema.optional(),
  routeId: gtfsIdSchema.optional(),
  userId: uuidSchema.optional(),
  status: reportStatusSchema.optional(),
  scope: reportScopeSchema.optional(),
  minConfidence: z.coerce.number().int().min(0).max(100).optional(),
  maxConfidence: z.coerce.number().int().min(0).max(100).optional(),
  /** Nur Meldungen mit offenen Missbrauchsmeldungen. */
  flaggedOnly: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AdminReportFilter = z.infer<typeof adminReportFilterSchema>;

export const adminReportSchema = z.object({
  id: uuidSchema,
  categoryKey: z.string(),
  scope: reportScopeSchema,
  status: reportStatusSchema,
  confidence: z.number().int(),
  upvotes: z.number().int(),
  downvotes: z.number().int(),
  flagsCount: z.number().int(),
  message: z.string().nullable(),
  agencyId: gtfsIdSchema.nullable(),
  routeId: gtfsIdSchema.nullable(),
  routeShortName: z.string().nullable(),
  tripId: gtfsIdSchema.nullable(),
  stopId: gtfsIdSchema.nullable(),
  stopName: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  userId: uuidSchema,
  userAlias: z.string(),
  userStatus: accountStatusSchema,
  userReputation: z.number().int(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type AdminReport = z.infer<typeof adminReportSchema>;

export const moderateReportInputSchema = z.object({
  action: z.enum(['APPROVE', 'REMOVE', 'RESTORE']),
  reason: z.string().trim().min(3).max(500),
});
export type ModerateReportInput = z.infer<typeof moderateReportInputSchema>;

export const adminUserSchema = z.object({
  id: uuidSchema,
  alias: z.string(),
  role: userRoleSchema,
  status: accountStatusSchema,
  reputationScore: z.number().int(),
  reportsCount: z.number().int(),
  removedReportsCount: z.number().int(),
  flagsReceived: z.number().int(),
  createdAt: z.string(),
  lastActiveAt: z.string().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const moderateUserInputSchema = z.object({
  action: z.enum(['WARN', 'SHADOW_FLAG', 'SUSPEND', 'REINSTATE']),
  reason: z.string().trim().min(3).max(500),
  /** Sperrdauer in Stunden; nur für SUSPEND. `null` = unbefristet. */
  durationHours: z.number().int().min(1).max(24 * 365).nullable().optional(),
});
export type ModerateUserInput = z.infer<typeof moderateUserInputSchema>;

export const moderationActionSchema = z.object({
  id: uuidSchema,
  action: moderationActionTypeSchema,
  reason: z.string(),
  moderatorAlias: z.string(),
  targetReportId: uuidSchema.nullable(),
  targetUserId: uuidSchema.nullable(),
  createdAt: z.string(),
});
export type ModerationAction = z.infer<typeof moderationActionSchema>;

export const auditLogSchema = z.object({
  id: uuidSchema,
  actorId: uuidSchema.nullable(),
  actorAlias: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** Administrativ änderbare Kategorie-Felder (§32). `key` ist unveränderlich. */
export const upsertCategoryInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'Nur Kleinbuchstaben, Ziffern und Unterstriche'),
  label: localizedTextSchema,
  description: localizedTextSchema.nullable().optional(),
  icon: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  group: z.enum(['CAPACITY', 'DISRUPTION', 'VEHICLE', 'STATION', 'SAFETY', 'INFO', 'OTHER']),
  defaultScope: reportScopeSchema,
  allowedScopes: z.array(reportScopeSchema).min(1),
  ttlSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30),
  ttlUntilTripEnd: z.boolean().default(false),
  requiresTrip: z.boolean().default(false),
  requiresModeration: z.boolean().default(false),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  sortOrder: z.number().int().default(100),
  active: z.boolean().default(true),
});
export type UpsertCategoryInput = z.infer<typeof upsertCategoryInputSchema>;

/**
 * Laufzeitkonfiguration (`app_config`). Alle Werte sind im Admin-Portal änderbar
 * und werden serverseitig validiert — nie clientseitig gesetzt.
 */
export const runtimeConfigSchema = z.object({
  detection: z.object({
    autoThreshold: z.number().min(0.5).max(1),
    confirmThreshold: z.number().min(0.3).max(1),
    defaultRadiusMeters: z.number().int().min(100).max(5000),
    maxCandidates: z.number().int().min(1).max(50),
    weights: z.object({
      shapeDistance: z.number().min(0).max(1),
      timeCompatibility: z.number().min(0).max(1),
      directionCompatibility: z.number().min(0).max(1),
      speedCompatibility: z.number().min(0).max(1),
      stopSequence: z.number().min(0).max(1),
      realtimeCompatibility: z.number().min(0).max(1),
    }),
  }),
  rateLimits: z.object({
    reportsPerHour: z.number().int().min(1).max(1000),
    reportsPerDay: z.number().int().min(1).max(5000),
    votesPerHour: z.number().int().min(1).max(5000),
    flagsPerDay: z.number().int().min(1).max(1000),
    /** Mindestabstand zwischen zwei Meldungen desselben Nutzers in Sekunden. */
    reportCooldownSeconds: z.number().int().min(0).max(3600),
    /** Mindestabstand für dieselbe Kategorie auf derselben Fahrt. */
    duplicateWindowSeconds: z.number().int().min(0).max(7200),
  }),
  moderation: z.object({
    /** Ab dieser Anzahl Missbrauchsmeldungen geht eine Meldung in die Queue. */
    autoQueueFlagThreshold: z.number().int().min(1).max(50),
    /** Ab diesem Verhältnis Gegenstimmen wird eine Meldung automatisch beendet. */
    autoExpireDownvoteRatio: z.number().min(0.5).max(1),
    /** Minimale Anzahl Stimmen, bevor die Ratio greift. */
    autoExpireMinVotes: z.number().int().min(1).max(50),
    /** Reputation, unterhalb derer Meldungen vormoderiert werden. */
    preModerationReputationBelow: z.number().int().min(-1000).max(1000),
  }),
  trust: z.object({
    baseScore: z.number().int().min(0).max(100),
    upvoteWeight: z.number().min(0).max(50),
    downvoteWeight: z.number().min(0).max(50),
    tripSessionBonus: z.number().min(0).max(50),
    gpsPlausibilityBonus: z.number().min(0).max(50),
    reputationWeight: z.number().min(0).max(50),
    ageDecayHalfLifeMinutes: z.number().int().min(1).max(10_000),
  }),
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const featureFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  description: z.string().nullable(),
  rolloutPercentage: z.number().int().min(0).max(100),
  updatedAt: z.string(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;
