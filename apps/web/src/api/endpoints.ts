import type {
  CreateReportInput,
  Departure,
  FeedItem,
  Favorite,
  Journey,
  Profile,
  Report,
  ReportCategory,
  ServiceAlert,
  Stop,
  Trip,
  TripDetectionResponse,
  TripSession,
  UserSettings,
} from '@swissov/types';
import { apiRequest } from './client';

/**
 * Typisierte Hüllen um die REST-Endpunkte.
 * Ein Ort für alle Pfade — Screens kennen keine URLs.
 */

/**
 * Teilaktualisierung der Einstellungen — auch einzelne Benachrichtigungs-
 * schalter dürfen isoliert gesendet werden (entspricht dem Serverschema).
 */
export type UserSettingsPatch = Partial<Omit<UserSettings, 'notifications'>> & {
  notifications?: Partial<UserSettings['notifications']>;
};

export interface AppConfigResponse {
  categories: ReportCategory[];
  features: Record<string, boolean>;
  detection: { autoThreshold: number; confirmThreshold: number; defaultRadiusMeters: number };
  limits: { messageMaxLength: number; reportsPerHour: number };
  dataSources: {
    timetable: boolean;
    realtime: boolean;
    officialAlerts: boolean;
    journeyPlanner: string;
  };
  /**
   * Web Push. Nur der ÖFFENTLICHE VAPID-Schlüssel wird ausgeliefert — der
   * private Schlüssel verlässt den Worker-Prozess nie (§42).
   */
  webPush: { enabled: boolean; publicKey: string | null };
}

/** Ein Browser-Push-Abo, wie es `PushManager.subscribe()` liefert. */
export interface WebPushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export const api = {
  appConfig: () => apiRequest<AppConfigResponse>('/v1/app-config'),

  // --- Fahrplan -------------------------------------------------------------
  stopsNearby: (lat: number, lon: number, radius = 800, limit = 25) =>
    apiRequest<{ stops: Stop[] }>('/v1/stops/nearby', { query: { lat, lon, radius, limit } }),

  stop: (stopId: string) => apiRequest<{ stop: Stop }>(`/v1/stops/${encodeURIComponent(stopId)}`),

  departures: (stopId: string, limit = 20) =>
    apiRequest<{ departures: Departure[]; realtimeAvailable: boolean }>(
      `/v1/stops/${encodeURIComponent(stopId)}/departures`,
      { query: { limit } },
    ),

  departuresForStops: (stopIds: string[], limit = 4) =>
    apiRequest<{ byStop: Array<{ stopId: string; departures: Departure[] }> }>('/v1/departures', {
      query: { stopIds: stopIds.join(','), limit },
    }),

  trip: (tripId: string, serviceDate?: string) =>
    apiRequest<{ trip: Trip }>(`/v1/trips/${encodeURIComponent(tripId)}`, {
      query: { serviceDate },
    }),

  search: (q: string, limit = 12) =>
    apiRequest<{
      results: Array<{
        kind: 'STOP' | 'ROUTE';
        id: string;
        name: string;
        subtitle: string | null;
        lat: number | null;
        lon: number | null;
        vehicleType: string | null;
        score: number;
      }>;
    }>('/v1/search', { query: { q, limit } }),

  alerts: (params: { routeId?: string; stopId?: string; tripId?: string } = {}) =>
    apiRequest<{ alerts: ServiceAlert[] }>('/v1/alerts', { query: params }),

  // --- Fahrtenerkennung -----------------------------------------------------
  detectTrip: (body: {
    observations: Array<{
      lat: number;
      lon: number;
      accuracy?: number;
      speed?: number;
      heading?: number;
      timestamp: string;
    }>;
    limit?: number;
    radiusMeters?: number;
  }) => apiRequest<TripDetectionResponse>('/v1/trip-detection', { method: 'POST', body }),

  currentSession: () => apiRequest<{ session: TripSession | null }>('/v1/trip-sessions/current'),

  startSession: (body: {
    tripId: string;
    serviceDate: string;
    confidence: number;
    detectionMethod: 'AUTO_GPS' | 'AUTO_STOP_SEQUENCE' | 'MANUAL';
  }) => apiRequest<{ session: TripSession }>('/v1/trip-sessions', { method: 'POST', body }),

  updateSessionPosition: (
    sessionId: string,
    observation: { lat: number; lon: number; timestamp: string; accuracy?: number; speed?: number },
  ) =>
    apiRequest<void>(`/v1/trip-sessions/${sessionId}/position`, {
      method: 'POST',
      body: { observation },
    }),

  followSession: (sessionId: string, following: boolean) =>
    apiRequest<{ session: TripSession }>(`/v1/trip-sessions/${sessionId}/follow`, {
      method: 'POST',
      body: { following },
    }),

  endSession: (sessionId: string) =>
    apiRequest<void>(`/v1/trip-sessions/${sessionId}`, { method: 'DELETE' }),

  // --- Meldungen ------------------------------------------------------------
  categories: () => apiRequest<{ categories: ReportCategory[] }>('/v1/reports/categories'),

  reports: (query: {
    tripId?: string;
    serviceDate?: string;
    routeId?: string;
    stopId?: string;
    lat?: number;
    lon?: number;
    radiusMeters?: number;
    includeOfficial?: boolean;
    limit?: number;
  }) => apiRequest<{ items: FeedItem[] }>('/v1/reports', { query }),

  tripReports: (tripId: string, serviceDate?: string) =>
    apiRequest<{ items: FeedItem[] }>(`/v1/trips/${encodeURIComponent(tripId)}/reports`, {
      query: { serviceDate },
    }),

  report: (reportId: string) =>
    apiRequest<{ report: Report }>(`/v1/reports/${encodeURIComponent(reportId)}`),

  createReport: (body: CreateReportInput) =>
    apiRequest<{ report: Report; mergedInto?: string; warnings: string[] }>('/v1/reports', {
      method: 'POST',
      body,
    }),

  voteReport: (reportId: string, vote: 1 | -1) =>
    apiRequest<{ report: Report }>(`/v1/reports/${reportId}/vote`, {
      method: 'POST',
      body: { vote },
    }),

  flagReport: (reportId: string, reason: string, note?: string) =>
    apiRequest<{ queuedForModeration: boolean }>(`/v1/reports/${reportId}/flag`, {
      method: 'POST',
      body: { reason, note },
    }),

  // --- Verbindungen ---------------------------------------------------------
  searchJourneys: (params: { from: string; to: string; at?: string; timeMode?: string }) =>
    apiRequest<{ journeys: Journey[]; provider: string; limitations: string[] }>(
      '/v1/journeys/search',
      { query: params },
    ),

  // --- Konto ----------------------------------------------------------------
  me: () => apiRequest<{ profile: Profile; settings: UserSettings }>('/v1/me'),

  updateSettings: (patch: UserSettingsPatch) =>
    apiRequest<{ settings: UserSettings }>('/v1/me/settings', { method: 'PATCH', body: patch }),

  myReports: (limit = 50) =>
    apiRequest<{ reports: Report[] }>('/v1/me/reports', { query: { limit } }),

  favorites: () => apiRequest<{ favorites: Favorite[] }>('/v1/me/favorites'),

  addFavorite: (body: {
    kind: 'STOP' | 'ROUTE' | 'JOURNEY';
    label: string;
    stopId?: string;
    routeId?: string;
    originStopId?: string;
    destinationStopId?: string;
  }) => apiRequest<{ favorite: Favorite }>('/v1/me/favorites', { method: 'POST', body }),

  removeFavorite: (favoriteId: string) =>
    apiRequest<void>(`/v1/me/favorites/${favoriteId}`, { method: 'DELETE' }),

  registerDevice: (body: {
    installId: string;
    platform: 'web';
    appVersion: string;
    osVersion?: string;
  }) =>
    apiRequest<{ deviceId: string; pushRegistered: boolean }>('/v1/me/devices', {
      method: 'POST',
      body,
    }),

  // --- Web Push -------------------------------------------------------------

  /**
   * Meldet ein Browser-Push-Abo an. Der Endpunkt ist gerätespezifisch und
   * ersetzt den früheren Expo-Token.
   */
  registerPushSubscription: (body: {
    installId: string;
    subscription: WebPushSubscriptionInput;
    userAgent?: string;
  }) =>
    apiRequest<{ subscriptionId: string }>('/v1/me/push-subscriptions', {
      method: 'POST',
      body,
    }),

  /** Meldet ein Abo ab. Der Endpunkt identifiziert das Abo. */
  removePushSubscription: (endpoint: string) =>
    apiRequest<void>('/v1/me/push-subscriptions', {
      method: 'DELETE',
      body: { endpoint },
    }),

  exportData: () => apiRequest<Record<string, unknown>>('/v1/me/export', { timeoutMs: 60_000 }),

  deleteAccount: () =>
    apiRequest<{ deleted: boolean; authAccountDeleted: boolean; note: string }>('/v1/me', {
      method: 'DELETE',
      body: { confirm: true },
    }),
};
