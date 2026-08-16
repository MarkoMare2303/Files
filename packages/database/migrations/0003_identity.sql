-- 0003_identity.sql
-- Nutzerprofile, Geräte, Einstellungen, Push-Abonnements, Favoriten.

CREATE TYPE public.user_role AS ENUM ('USER', 'MODERATOR', 'ADMIN');
CREATE TYPE public.account_status AS ENUM ('ACTIVE', 'SHADOW_FLAGGED', 'SUSPENDED', 'DELETED');
CREATE TYPE public.app_locale AS ENUM ('de', 'fr', 'it', 'en');
CREATE TYPE public.app_theme AS ENUM ('SYSTEM', 'LIGHT', 'DARK');
CREATE TYPE public.device_platform AS ENUM ('ios', 'android');
CREATE TYPE public.favorite_kind AS ENUM ('STOP', 'ROUTE', 'JOURNEY');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,

  -- Pseudonym für die Anzeige. Bewusst kein Klarname und keine E-Mail (§23).
  alias text NOT NULL,

  role public.user_role NOT NULL DEFAULT 'USER',
  status public.account_status NOT NULL DEFAULT 'ACTIVE',
  locale public.app_locale NOT NULL DEFAULT 'de',

  -- Interner Reputationswert, -100..100 (§20). Nie öffentlich ausgeliefert.
  reputation_score integer NOT NULL DEFAULT 0
    CHECK (reputation_score BETWEEN -100 AND 100),

  reports_count integer NOT NULL DEFAULT 0 CHECK (reports_count >= 0),
  confirmed_reports_count integer NOT NULL DEFAULT 0 CHECK (confirmed_reports_count >= 0),
  removed_reports_count integer NOT NULL DEFAULT 0 CHECK (removed_reports_count >= 0),

  -- Sperre bis (NULL = unbefristet gesperrt bzw. nicht gesperrt).
  suspended_until timestamptz,

  terms_accepted_at timestamptz,
  last_active_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Soft-Delete: Nutzerdaten werden anonymisiert, Beiträge bleiben für die
  -- Datenintegrität bestehen (siehe docs/privacy-architecture.md).
  deleted_at timestamptz,

  CONSTRAINT profiles_alias_length CHECK (char_length(alias) BETWEEN 2 AND 40)
);

COMMENT ON TABLE public.profiles IS 'Anwendungsprofil zu einem Auth-Konto. 1:1 zu auth.users.';
COMMENT ON COLUMN public.profiles.reputation_score IS
  'Internes Vertrauenssignal (§20). Darf nicht als öffentlicher Punktestand angezeigt werden.';

CREATE INDEX profiles_role_idx ON public.profiles (role) WHERE role <> 'USER';
CREATE INDEX profiles_status_idx ON public.profiles (status) WHERE status <> 'ACTIVE';
CREATE INDEX profiles_last_active_idx ON public.profiles (last_active_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,

  -- App-generierte Installations-ID. Bewusst KEIN Hardware-Identifier
  -- (IDFA/Android-ID) — datenschutzverträgliches Fingerprinting (§21/§23).
  install_id uuid NOT NULL,

  platform public.device_platform NOT NULL,
  app_version text NOT NULL,
  os_version text,

  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, install_id),
  CONSTRAINT devices_app_version_length CHECK (char_length(app_version) <= 32)
);

CREATE INDEX devices_install_idx ON public.devices (install_id);
CREATE INDEX devices_user_idx ON public.devices (user_id);

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,

  locale public.app_locale NOT NULL DEFAULT 'de',
  theme public.app_theme NOT NULL DEFAULT 'SYSTEM',

  notify_official_disruptions boolean NOT NULL DEFAULT true,
  notify_delays boolean NOT NULL DEFAULT true,
  notify_high_occupancy boolean NOT NULL DEFAULT false,
  notify_vehicle_issues boolean NOT NULL DEFAULT true,
  notify_safety boolean NOT NULL DEFAULT true,
  notify_connection_at_risk boolean NOT NULL DEFAULT true,
  notify_community_reports boolean NOT NULL DEFAULT true,

  -- Einwilligungen: Default false, aktive Zustimmung erforderlich (§23).
  background_location_consent boolean NOT NULL DEFAULT false,
  background_location_consent_at timestamptz,
  analytics_consent boolean NOT NULL DEFAULT false,
  analytics_consent_at timestamptz,

  auto_trip_detection boolean NOT NULL DEFAULT true,
  auto_follow_detected_trip boolean NOT NULL DEFAULT false,
  reduced_motion boolean NOT NULL DEFAULT false,

  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.user_settings.background_location_consent IS
  'Getrennte Einwilligung für Hintergrund-Standort. Ohne diese wird ausschliesslich im Vordergrund geortet.';

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices (id) ON DELETE CASCADE,

  expo_push_token text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,

  -- Zähler für automatische Deaktivierung bei dauerhaft ungültigen Tokens.
  failure_count integer NOT NULL DEFAULT 0,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT push_token_length CHECK (char_length(expo_push_token) BETWEEN 10 AND 256)
);

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions (user_id) WHERE enabled;

-- ---------------------------------------------------------------------------
-- favorites (§26)
-- ---------------------------------------------------------------------------
CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,

  kind public.favorite_kind NOT NULL,
  label text NOT NULL,

  -- GTFS-Referenzen als Text: Fahrplanfeeds werden zyklisch ersetzt, ein
  -- Fremdschlüssel würde Nutzerdaten beim Feed-Wechsel kaskadierend löschen.
  stop_id text,
  route_id text,
  origin_stop_id text,
  destination_stop_id text,

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT favorites_label_length CHECK (char_length(label) BETWEEN 1 AND 120),
  CONSTRAINT favorites_reference_present CHECK (
    (kind = 'STOP' AND stop_id IS NOT NULL)
    OR (kind = 'ROUTE' AND route_id IS NOT NULL)
    OR (kind = 'JOURNEY' AND origin_stop_id IS NOT NULL AND destination_stop_id IS NOT NULL)
  )
);

CREATE INDEX favorites_user_idx ON public.favorites (user_id, sort_order);
CREATE UNIQUE INDEX favorites_unique_stop
  ON public.favorites (user_id, stop_id) WHERE kind = 'STOP';
CREATE UNIQUE INDEX favorites_unique_route
  ON public.favorites (user_id, route_id) WHERE kind = 'ROUTE';
CREATE UNIQUE INDEX favorites_unique_journey
  ON public.favorites (user_id, origin_stop_id, destination_stop_id) WHERE kind = 'JOURNEY';

-- ---------------------------------------------------------------------------
-- updated_at-Trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER user_settings_set_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER push_subscriptions_set_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
