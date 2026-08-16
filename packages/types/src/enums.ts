import { z } from 'zod';

/**
 * Reichweite einer Community-Meldung (Master-Prompt §16).
 * Bestimmt, wem eine Meldung angezeigt wird und wie sie geografisch verankert ist.
 */
export const ReportScope = {
  /** Gilt für genau eine Fahrt (trip_id + service_date), z. B. „Klimaanlage defekt". */
  VEHICLE_TRIP: 'VEHICLE_TRIP',
  /** Gilt für einen Streckenabschnitt zwischen zwei Halten, z. B. „Streckenunterbruch". */
  ROUTE_SEGMENT: 'ROUTE_SEGMENT',
  /** Gilt für eine einzelne Haltestelle/Kante (Bus-/Tramhaltestelle). */
  STOP: 'STOP',
  /** Gilt für einen ganzen Bahnhof inkl. Unterhaltestellen, z. B. „Lift defekt". */
  STATION: 'STATION',
  /** Netzweite Information (nur Moderation/Admin darf diesen Scope vergeben). */
  NETWORK: 'NETWORK',
} as const;
export type ReportScope = (typeof ReportScope)[keyof typeof ReportScope];
export const reportScopeSchema = z.nativeEnum(ReportScope);

/** Lebenszyklus einer Meldung. */
export const ReportStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  /** Von der Moderation entfernt. */
  REMOVED: 'REMOVED',
  /** In der Moderations-Queue, für andere Nutzer unsichtbar. */
  PENDING_REVIEW: 'PENDING_REVIEW',
  /** Shadow-Flagging: Autor sieht die Meldung, sonst niemand (§21). */
  SHADOWED: 'SHADOWED',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];
export const reportStatusSchema = z.nativeEnum(ReportStatus);

/** Wie wurde die Fahrt des Nutzers ermittelt (§36)? */
export const DetectionMethod = {
  AUTO_GPS: 'AUTO_GPS',
  AUTO_STOP_SEQUENCE: 'AUTO_STOP_SEQUENCE',
  MANUAL: 'MANUAL',
} as const;
export type DetectionMethod = (typeof DetectionMethod)[keyof typeof DetectionMethod];
export const detectionMethodSchema = z.nativeEnum(DetectionMethod);

/**
 * Fahrzeugkategorien, abgeleitet aus GTFS `route_type`
 * (inkl. der erweiterten Google-Route-Types, die im Schweizer Datensatz vorkommen).
 */
export const VehicleType = {
  TRAM: 'TRAM',
  SUBWAY: 'SUBWAY',
  RAIL: 'RAIL',
  BUS: 'BUS',
  FERRY: 'FERRY',
  CABLE_TRAM: 'CABLE_TRAM',
  AERIAL_LIFT: 'AERIAL_LIFT',
  FUNICULAR: 'FUNICULAR',
  TROLLEYBUS: 'TROLLEYBUS',
  MONORAIL: 'MONORAIL',
  UNKNOWN: 'UNKNOWN',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];
export const vehicleTypeSchema = z.nativeEnum(VehicleType);

/** Rollen im System. Autorisierung passiert ausschliesslich serverseitig (§42). */
export const UserRole = {
  USER: 'USER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const userRoleSchema = z.nativeEnum(UserRole);

export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  /** Beiträge werden nur dem Autor angezeigt. */
  SHADOW_FLAGGED: 'SHADOW_FLAGGED',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];
export const accountStatusSchema = z.nativeEnum(AccountStatus);

/** Meldungsgrund bei Missbrauchsmeldungen durch Nutzer. */
export const FlagReason = {
  SPAM: 'SPAM',
  INCORRECT: 'INCORRECT',
  OFFENSIVE: 'OFFENSIVE',
  PERSONAL_DATA: 'PERSONAL_DATA',
  OTHER: 'OTHER',
} as const;
export type FlagReason = (typeof FlagReason)[keyof typeof FlagReason];
export const flagReasonSchema = z.nativeEnum(FlagReason);

export const ModerationActionType = {
  REPORT_APPROVED: 'REPORT_APPROVED',
  REPORT_REMOVED: 'REPORT_REMOVED',
  REPORT_RESTORED: 'REPORT_RESTORED',
  USER_WARNED: 'USER_WARNED',
  USER_SHADOW_FLAGGED: 'USER_SHADOW_FLAGGED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_REINSTATED: 'USER_REINSTATED',
} as const;
export type ModerationActionType =
  (typeof ModerationActionType)[keyof typeof ModerationActionType];
export const moderationActionTypeSchema = z.nativeEnum(ModerationActionType);

/** Quelle einer Information — offizielle Daten und Community dürfen nie verwechselt werden (§7). */
export const InfoSource = {
  OFFICIAL: 'OFFICIAL',
  COMMUNITY: 'COMMUNITY',
} as const;
export type InfoSource = (typeof InfoSource)[keyof typeof InfoSource];
export const infoSourceSchema = z.nativeEnum(InfoSource);

/** Schweregrad offizieller Meldungen (GTFS-RT `SeverityLevel`). */
export const AlertSeverity = {
  UNKNOWN: 'UNKNOWN',
  INFO: 'INFO',
  WARNING: 'WARNING',
  SEVERE: 'SEVERE',
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];
export const alertSeveritySchema = z.nativeEnum(AlertSeverity);

/** Feature-Flags (§62). Der Schlüsselraum ist bewusst geschlossen typisiert. */
export const FeatureFlagKey = {
  AUTO_TRIP_DETECTION: 'auto_trip_detection',
  COMMUNITY_REPORTS: 'community_reports',
  PUSH_NOTIFICATIONS: 'push_notifications',
  OJP_ROUTING: 'ojp_routing',
  STATION_REPORTS: 'station_reports',
  GUEST_MODE: 'guest_mode',
} as const;
export type FeatureFlagKey = (typeof FeatureFlagKey)[keyof typeof FeatureFlagKey];
export const featureFlagKeySchema = z.nativeEnum(FeatureFlagKey);

/** Unterstützte Sprachen (§45). */
export const Locale = {
  DE: 'de',
  FR: 'fr',
  IT: 'it',
  EN: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
export const localeSchema = z.nativeEnum(Locale);

/** Status eines GTFS-Static-Imports. */
export const GtfsImportStatus = {
  PENDING: 'PENDING',
  DOWNLOADING: 'DOWNLOADING',
  IMPORTING: 'IMPORTING',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  FAILED: 'FAILED',
} as const;
export type GtfsImportStatus = (typeof GtfsImportStatus)[keyof typeof GtfsImportStatus];
export const gtfsImportStatusSchema = z.nativeEnum(GtfsImportStatus);

/**
 * Mapping von GTFS `route_type` auf die interne Fahrzeugkategorie.
 * Deckt Basis-Typen (0–12) und die erweiterten Typen (100–1700) ab, die
 * im Schweizer Datensatz verwendet werden.
 */
export function vehicleTypeFromRouteType(routeType: number | null | undefined): VehicleType {
  if (routeType === null || routeType === undefined || Number.isNaN(routeType)) {
    return VehicleType.UNKNOWN;
  }
  switch (routeType) {
    case 0:
      return VehicleType.TRAM;
    case 1:
      return VehicleType.SUBWAY;
    case 2:
      return VehicleType.RAIL;
    case 3:
      return VehicleType.BUS;
    case 4:
      return VehicleType.FERRY;
    case 5:
      return VehicleType.CABLE_TRAM;
    case 6:
      return VehicleType.AERIAL_LIFT;
    case 7:
      return VehicleType.FUNICULAR;
    case 11:
      return VehicleType.TROLLEYBUS;
    case 12:
      return VehicleType.MONORAIL;
    default:
      break;
  }
  // Erweiterte Route-Types (HVT / "Extended GTFS Route Types")
  if (routeType >= 100 && routeType <= 199) return VehicleType.RAIL;
  if (routeType >= 200 && routeType <= 299) return VehicleType.BUS; // Coach
  if (routeType >= 400 && routeType <= 499) return VehicleType.SUBWAY; // Urban rail
  if (routeType >= 700 && routeType <= 799) return VehicleType.BUS;
  if (routeType === 800) return VehicleType.TROLLEYBUS;
  if (routeType >= 900 && routeType <= 999) return VehicleType.TRAM;
  if (routeType >= 1000 && routeType <= 1099) return VehicleType.FERRY;
  if (routeType >= 1100 && routeType <= 1199) return VehicleType.UNKNOWN; // Air
  if (routeType >= 1300 && routeType <= 1399) return VehicleType.AERIAL_LIFT;
  if (routeType >= 1400 && routeType <= 1499) return VehicleType.FUNICULAR;
  if (routeType >= 1500 && routeType <= 1599) return VehicleType.BUS; // Taxi/Rufbus
  return VehicleType.UNKNOWN;
}

/**
 * Typische Reisegeschwindigkeitsbereiche in km/h je Fahrzeugkategorie.
 * Wird im Confidence-Scoring (`speed compatibility`) verwendet.
 */
export const VEHICLE_SPEED_PROFILE: Record<VehicleType, { typical: number; max: number }> = {
  [VehicleType.TRAM]: { typical: 18, max: 70 },
  [VehicleType.SUBWAY]: { typical: 30, max: 90 },
  [VehicleType.RAIL]: { typical: 75, max: 250 },
  [VehicleType.BUS]: { typical: 22, max: 100 },
  [VehicleType.FERRY]: { typical: 20, max: 60 },
  [VehicleType.CABLE_TRAM]: { typical: 12, max: 40 },
  [VehicleType.AERIAL_LIFT]: { typical: 18, max: 45 },
  [VehicleType.FUNICULAR]: { typical: 15, max: 45 },
  [VehicleType.TROLLEYBUS]: { typical: 20, max: 75 },
  [VehicleType.MONORAIL]: { typical: 40, max: 90 },
  [VehicleType.UNKNOWN]: { typical: 30, max: 250 },
};
