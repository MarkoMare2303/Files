import type { Database } from '@swissov/database';
import { reputationTier } from '@swissov/shared';
import { AppError, ErrorCode } from '@swissov/shared';
import type {
  AccountStatus,
  NotificationSettings,
  Profile,
  UserRole,
  UserSettings,
} from '@swissov/types';
import { generateAlias } from '../lib/crypto.js';

/**
 * Teilaktualisierung der Einstellungen. `notifications` wird getrennt
 * ausgeklammert, weil auch einzelne Schalter darin optional sein dürfen.
 */
export type UserSettingsPatch = Partial<Omit<UserSettings, 'notifications'>> & {
  notifications?: Partial<NotificationSettings> | undefined;
};

export interface ProfileRow {
  id: string;
  alias: string;
  role: UserRole;
  status: AccountStatus;
  locale: 'de' | 'fr' | 'it' | 'en';
  reputation_score: number;
  reports_count: number;
  confirmed_reports_count: number;
  removed_reports_count: number;
  suspended_until: Date | null;
  created_at: Date;
  last_active_at: Date | null;
  deleted_at: Date | null;
}

export interface SettingsRow {
  user_id: string;
  locale: 'de' | 'fr' | 'it' | 'en';
  theme: 'SYSTEM' | 'LIGHT' | 'DARK';
  notify_official_disruptions: boolean;
  notify_delays: boolean;
  notify_high_occupancy: boolean;
  notify_vehicle_issues: boolean;
  notify_safety: boolean;
  notify_connection_at_risk: boolean;
  notify_community_reports: boolean;
  background_location_consent: boolean;
  analytics_consent: boolean;
  auto_trip_detection: boolean;
  auto_follow_detected_trip: boolean;
  reduced_motion: boolean;
}

export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly aliasSecret: string,
    private readonly authMode: 'shim' | 'supabase',
  ) {}

  /**
   * Lädt das Profil zu einem Auth-Konto und legt es beim ersten Zugriff an.
   *
   * Bewusst hier statt per Datenbank-Trigger auf `auth.users`: Trigger im
   * Supabase-Auth-Schema benötigen erhöhte Rechte und scheitern still, wenn
   * diese fehlen. Die faule Erzeugung ist robust und idempotent.
   */
  async ensure(userId: string): Promise<ProfileRow> {
    const existing = await this.find(userId);
    if (existing) return existing;

    if (this.authMode === 'shim') {
      // Das Auth-Konto liegt nicht in dieser Datenbank — entweder bei Supabase
      // (Betrieb: eigene PostgreSQL, Anmeldung über Supabase) oder es gibt gar
      // keines (lokale Entwicklung). Der Stub existiert allein, um den
      // Fremdschlüssel von `public.profiles` zu erfüllen.
      //
      // Bewusst NUR die ID: die E-Mail-Adresse wird von der Anwendung nirgends
      // gelesen — das Profil führt keine (§23) — und würde hier lediglich
      // personenbezogene Daten ohne Zweck ansammeln.
      await this.db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [
        userId,
      ]);
    }

    const alias = generateAlias(userId, this.aliasSecret);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO public.profiles (id, alias, terms_accepted_at, last_active_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [userId, alias],
      );
      await tx.query(
        'INSERT INTO public.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId],
      );
    });

    const created = await this.find(userId);
    if (!created) throw new AppError(ErrorCode.INTERNAL, { message: 'Profil konnte nicht angelegt werden' });
    return created;
  }

  async find(userId: string): Promise<ProfileRow | null> {
    return this.db.queryOne<ProfileRow>(
      `SELECT id, alias, role, status, locale, reputation_score, reports_count,
              confirmed_reports_count, removed_reports_count, suspended_until,
              created_at, last_active_at, deleted_at
       FROM public.profiles WHERE id = $1`,
      [userId],
    );
  }

  /** Aktualisiert `last_active_at` höchstens einmal pro Stunde. */
  async touch(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE public.profiles SET last_active_at = now()
       WHERE id = $1 AND (last_active_at IS NULL OR last_active_at < now() - interval '1 hour')`,
      [userId],
    );
  }

  /**
   * Prüft, ob der Nutzer Beiträge erstellen darf.
   * Abgelaufene Sperren werden dabei automatisch aufgehoben.
   */
  async assertCanContribute(profile: ProfileRow): Promise<void> {
    if (profile.status === 'DELETED') {
      throw new AppError(ErrorCode.FORBIDDEN, { message: 'Konto gelöscht' });
    }
    if (profile.status === 'SUSPENDED') {
      if (profile.suspended_until && profile.suspended_until.getTime() <= Date.now()) {
        await this.db.query(
          `UPDATE public.profiles SET status = 'ACTIVE', suspended_until = NULL WHERE id = $1`,
          [profile.id],
        );
        profile.status = 'ACTIVE';
        return;
      }
      throw new AppError(ErrorCode.ACCOUNT_SUSPENDED);
    }
    // SHADOW_FLAGGED darf weiterhin melden — die Beiträge sind nur für den
    // Autor sichtbar (§21). Das ist beabsichtigt und wird nicht angezeigt.
  }

  toProfile(row: ProfileRow): Profile {
    const accountAgeDays = (Date.now() - row.created_at.getTime()) / 86_400_000;
    return {
      id: row.id,
      alias: row.alias,
      role: row.role,
      // Shadow-Flagging wird dem Nutzer gegenüber nie offengelegt.
      status: row.status === 'SHADOW_FLAGGED' ? 'ACTIVE' : row.status,
      locale: row.locale,
      createdAt: row.created_at.toISOString(),
      reputationTier: reputationTier({
        score: row.reputation_score,
        accountAgeDays,
        confirmedReports: row.confirmed_reports_count,
      }),
      reportsCount: row.reports_count,
      confirmedReportsCount: row.confirmed_reports_count,
    };
  }

  async getSettings(userId: string): Promise<UserSettings> {
    const row = await this.db.queryOne<SettingsRow>(
      'SELECT * FROM public.user_settings WHERE user_id = $1',
      [userId],
    );
    if (!row) {
      await this.db.query('INSERT INTO public.user_settings (user_id) VALUES ($1)', [userId]);
      return this.getSettings(userId);
    }
    return {
      locale: row.locale,
      theme: row.theme,
      notifications: {
        officialDisruptions: row.notify_official_disruptions,
        delays: row.notify_delays,
        highOccupancy: row.notify_high_occupancy,
        vehicleIssues: row.notify_vehicle_issues,
        safety: row.notify_safety,
        connectionAtRisk: row.notify_connection_at_risk,
        communityReports: row.notify_community_reports,
      },
      backgroundLocationConsent: row.background_location_consent,
      analyticsConsent: row.analytics_consent,
      autoTripDetection: row.auto_trip_detection,
      autoFollowDetectedTrip: row.auto_follow_detected_trip,
      reducedMotion: row.reduced_motion,
    };
  }

  async updateSettings(
    userId: string,
    patch: UserSettingsPatch,
  ): Promise<UserSettings> {
    const n = patch.notifications ?? {};
    await this.db.query(
      `UPDATE public.user_settings SET
         locale = COALESCE($2::public.app_locale, locale),
         theme = COALESCE($3::public.app_theme, theme),
         notify_official_disruptions = COALESCE($4, notify_official_disruptions),
         notify_delays = COALESCE($5, notify_delays),
         notify_high_occupancy = COALESCE($6, notify_high_occupancy),
         notify_vehicle_issues = COALESCE($7, notify_vehicle_issues),
         notify_safety = COALESCE($8, notify_safety),
         notify_connection_at_risk = COALESCE($9, notify_connection_at_risk),
         notify_community_reports = COALESCE($10, notify_community_reports),
         background_location_consent = COALESCE($11, background_location_consent),
         background_location_consent_at = CASE
           WHEN $11 IS TRUE AND background_location_consent IS FALSE THEN now()
           WHEN $11 IS FALSE THEN NULL
           ELSE background_location_consent_at END,
         analytics_consent = COALESCE($12, analytics_consent),
         analytics_consent_at = CASE
           WHEN $12 IS TRUE AND analytics_consent IS FALSE THEN now()
           WHEN $12 IS FALSE THEN NULL
           ELSE analytics_consent_at END,
         auto_trip_detection = COALESCE($13, auto_trip_detection),
         auto_follow_detected_trip = COALESCE($14, auto_follow_detected_trip),
         reduced_motion = COALESCE($15, reduced_motion)
       WHERE user_id = $1`,
      [
        userId,
        patch.locale ?? null,
        patch.theme ?? null,
        n.officialDisruptions ?? null,
        n.delays ?? null,
        n.highOccupancy ?? null,
        n.vehicleIssues ?? null,
        n.safety ?? null,
        n.connectionAtRisk ?? null,
        n.communityReports ?? null,
        patch.backgroundLocationConsent ?? null,
        patch.analyticsConsent ?? null,
        patch.autoTripDetection ?? null,
        patch.autoFollowDetectedTrip ?? null,
        patch.reducedMotion ?? null,
      ],
    );
    if (patch.locale) {
      await this.db.query('UPDATE public.profiles SET locale = $2::public.app_locale WHERE id = $1', [
        userId,
        patch.locale,
      ]);
    }
    return this.getSettings(userId);
  }
}
