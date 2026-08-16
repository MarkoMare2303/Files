-- 0007_admin.sql
-- Moderation, Audit-Log, Feature-Flags, Laufzeitkonfiguration.

CREATE TYPE public.moderation_action_type AS ENUM (
  'REPORT_APPROVED', 'REPORT_REMOVED', 'REPORT_RESTORED',
  'USER_WARNED', 'USER_SHADOW_FLAGGED', 'USER_SUSPENDED', 'USER_REINSTATED'
);

-- ---------------------------------------------------------------------------
-- moderation_actions
-- ---------------------------------------------------------------------------
CREATE TABLE public.moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  action public.moderation_action_type NOT NULL,
  target_report_id uuid REFERENCES public.reports (id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reason text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_has_target CHECK (
    target_report_id IS NOT NULL OR target_user_id IS NOT NULL
  ),
  CONSTRAINT moderation_reason_length CHECK (char_length(reason) BETWEEN 3 AND 500)
);

CREATE INDEX moderation_actions_created_idx ON public.moderation_actions (created_at DESC);
CREATE INDEX moderation_actions_user_idx
  ON public.moderation_actions (target_user_id, created_at DESC) WHERE target_user_id IS NOT NULL;
CREATE INDEX moderation_actions_report_idx
  ON public.moderation_actions (target_report_id) WHERE target_report_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- admin_audit_logs (§33) — jede administrative Änderung wird protokolliert
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  actor_alias text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  -- Für die Nachvollziehbarkeit administrativer Zugriffe erforderlich;
  -- Aufbewahrung siehe docs/privacy-architecture.md.
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
CREATE INDEX admin_audit_logs_actor_idx ON public.admin_audit_logs (actor_id, created_at DESC);
CREATE INDEX admin_audit_logs_entity_idx ON public.admin_audit_logs (entity_type, entity_id);

COMMENT ON TABLE public.admin_audit_logs IS
  'Revisionssicheres Protokoll. Wird ausschliesslich beschrieben, nie aktualisiert oder gelöscht (§33).';

-- Änderungen und Löschungen im Audit-Log unterbinden.
CREATE OR REPLACE FUNCTION public.deny_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs ist append-only';
END;
$$;

CREATE TRIGGER admin_audit_logs_no_update
  BEFORE UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.deny_audit_mutation();

-- ---------------------------------------------------------------------------
-- feature_flags (§62)
-- ---------------------------------------------------------------------------
CREATE TABLE public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  rollout_percentage integer NOT NULL DEFAULT 100
    CHECK (rollout_percentage BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT feature_flags_key_format CHECK (key ~ '^[a-z0-9_]{2,64}$')
);

CREATE TRIGGER feature_flags_set_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- app_config — Laufzeitkonfiguration (Schwellen, Rate Limits, Trust-Gewichte)
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);

CREATE TRIGGER app_config_set_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.app_config IS
  'Serverseitige Laufzeitkonfiguration. Wird nur über das Admin-Portal geändert und immer serverseitig validiert.';
