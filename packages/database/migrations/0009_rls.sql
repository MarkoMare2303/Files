-- 0009_rls.sql
--
-- Row Level Security (§33/§42).
--
-- Grundsatz: Schreibende Zugriffe auf Community-Daten laufen AUSSCHLIESSLICH
-- über die API (Fastify), weil dort Missbrauchsschutz, Trust-Berechnung und
-- Rate Limiting greifen. Für den anonymen bzw. authentifizierten Supabase-
-- Client (Realtime-Abonnements der Mobile-App) existieren deshalb bewusst
-- KEINE INSERT/UPDATE/DELETE-Policies auf `reports`, `report_votes` und
-- `report_flags` — Schreibversuche laufen ins Leere.

-- ---------------------------------------------------------------------------
-- RLS aktivieren
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reputation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_moderator()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public.current_profile_role() IN ('MODERATOR', 'ADMIN'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public.current_profile_role() = 'ADMIN', false)
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_moderator());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Eigene Daten: vollständige Kontrolle durch den Nutzer
-- ---------------------------------------------------------------------------
CREATE POLICY devices_own ON public.devices
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY user_settings_own ON public.user_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY push_subscriptions_own ON public.push_subscriptions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY favorites_own ON public.favorites
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY trip_sessions_own ON public.trip_sessions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY trip_follows_own ON public.trip_follows
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY reputation_events_own ON public.user_reputation_events
  FOR SELECT USING (user_id = auth.uid() OR public.is_moderator());

CREATE POLICY notification_queue_own ON public.notification_queue
  FOR SELECT USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- report_categories — für alle lesbar (die App braucht sie zum Melden)
-- ---------------------------------------------------------------------------
CREATE POLICY report_categories_read ON public.report_categories
  FOR SELECT USING (active OR public.is_moderator());

-- ---------------------------------------------------------------------------
-- reports
--
-- Lesbar sind aktive Meldungen sowie die eigenen (inkl. shadow-geflaggter —
-- der Autor soll den Unterschied nicht bemerken, §21).
-- Schreibrechte gibt es hier bewusst nicht: siehe Kopfkommentar.
-- ---------------------------------------------------------------------------
CREATE POLICY reports_read ON public.reports
  FOR SELECT USING (
    (status = 'ACTIVE' AND expires_at > now())
    OR user_id = auth.uid()
    OR public.is_moderator()
  );

CREATE POLICY report_votes_read ON public.report_votes
  FOR SELECT USING (user_id = auth.uid() OR public.is_moderator());

CREATE POLICY report_flags_read ON public.report_flags
  FOR SELECT USING (user_id = auth.uid() OR public.is_moderator());

-- ---------------------------------------------------------------------------
-- Moderation & Administration
-- ---------------------------------------------------------------------------
CREATE POLICY moderation_actions_read ON public.moderation_actions
  FOR SELECT USING (public.is_moderator());

CREATE POLICY audit_logs_read ON public.admin_audit_logs
  FOR SELECT USING (public.is_admin());

CREATE POLICY feature_flags_read ON public.feature_flags
  FOR SELECT USING (true);

CREATE POLICY app_config_read ON public.app_config
  FOR SELECT USING (public.is_admin());

-- abuse_signals: nur über die API (Service Role) — keine Policy = kein Zugriff.

-- ---------------------------------------------------------------------------
-- Schema-Rechte
-- ---------------------------------------------------------------------------
-- Das transit-Schema wird nicht über PostgREST exponiert. Falls es doch in
-- `db-schema` aufgenommen würde, greifen hier zumindest keine Schreibrechte.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA transit TO anon, authenticated';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA transit TO anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA transit GRANT SELECT ON TABLES TO anon, authenticated';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA transit FROM anon, authenticated';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Realtime-Publikation (§40)
--
-- Nur `reports` wird über Supabase Realtime verteilt. Die Mobile-App
-- abonniert gefiltert nach Trip/Route/Station — nie den gesamten Datenstrom.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reports'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.reports';
    END IF;
  END IF;
END
$$;

-- Damit Realtime-Empfänger den vollständigen alten Datensatz bei UPDATE sehen
-- (z. B. Statuswechsel ACTIVE → EXPIRED).
ALTER TABLE public.reports REPLICA IDENTITY FULL;
