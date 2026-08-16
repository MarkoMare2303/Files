-- 0006_community.sql
-- Community-Meldungen, Bestätigungen, Missbrauchsmeldungen, Trip-Sessions.

CREATE TYPE public.report_scope AS ENUM (
  'VEHICLE_TRIP', 'ROUTE_SEGMENT', 'STOP', 'STATION', 'NETWORK'
);
CREATE TYPE public.report_status AS ENUM (
  'ACTIVE', 'EXPIRED', 'REMOVED', 'PENDING_REVIEW', 'SHADOWED'
);
CREATE TYPE public.category_group AS ENUM (
  'CAPACITY', 'DISRUPTION', 'VEHICLE', 'STATION', 'SAFETY', 'INFO', 'OTHER'
);
CREATE TYPE public.category_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE public.detection_method AS ENUM ('AUTO_GPS', 'AUTO_STOP_SEQUENCE', 'MANUAL');
CREATE TYPE public.flag_reason AS ENUM (
  'SPAM', 'INCORRECT', 'OFFENSIVE', 'PERSONAL_DATA', 'OTHER'
);

-- ---------------------------------------------------------------------------
-- report_categories — administrativ erweiterbar (§2, §17, §32)
-- ---------------------------------------------------------------------------
CREATE TABLE public.report_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,

  -- Mehrsprachige Beschriftung {"de": "...", "fr": "...", ...}
  label jsonb NOT NULL,
  description jsonb,

  icon text NOT NULL,
  color text NOT NULL,
  "group" public.category_group NOT NULL DEFAULT 'OTHER',

  default_scope public.report_scope NOT NULL DEFAULT 'VEHICLE_TRIP',
  allowed_scopes public.report_scope[] NOT NULL DEFAULT ARRAY['VEHICLE_TRIP']::public.report_scope[],

  -- Lebensdauer (§17)
  ttl_seconds integer NOT NULL CHECK (ttl_seconds BETWEEN 60 AND 2592000),
  ttl_until_trip_end boolean NOT NULL DEFAULT false,

  requires_trip boolean NOT NULL DEFAULT false,
  requires_moderation boolean NOT NULL DEFAULT false,
  severity public.category_severity NOT NULL DEFAULT 'MEDIUM',

  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_categories_key_format CHECK (key ~ '^[a-z0-9_]{2,64}$'),
  CONSTRAINT report_categories_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT report_categories_label_has_de CHECK (label ? 'de'),
  CONSTRAINT report_categories_default_scope_allowed CHECK (default_scope = ANY (allowed_scopes))
);

CREATE INDEX report_categories_active_idx ON public.report_categories (active, sort_order);

-- ---------------------------------------------------------------------------
-- trip_sessions (§36)
-- ---------------------------------------------------------------------------
CREATE TABLE public.trip_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,

  trip_id text NOT NULL,
  service_date date NOT NULL,
  route_id text,
  agency_id text,
  vehicle_type text,

  confidence numeric(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  detection_method public.detection_method NOT NULL,

  -- Push-Benachrichtigungen für diese Fahrt (§25 Smart Follow).
  following boolean NOT NULL DEFAULT false,

  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_reason text,

  -- Letzte bekannte Position, ausschliesslich für Plausibilitätsprüfungen (§21).
  -- Wird beim Sitzungsende gelöscht — es entsteht keine Bewegungshistorie (§23).
  last_position geography(Point, 4326)
);

CREATE INDEX trip_sessions_user_idx ON public.trip_sessions (user_id, started_at DESC);
CREATE INDEX trip_sessions_trip_idx ON public.trip_sessions (trip_id, service_date);
CREATE UNIQUE INDEX trip_sessions_one_active_per_user
  ON public.trip_sessions (user_id) WHERE ended_at IS NULL;
CREATE INDEX trip_sessions_following_idx
  ON public.trip_sessions (trip_id, service_date) WHERE following AND ended_at IS NULL;

COMMENT ON COLUMN public.trip_sessions.last_position IS
  'Nur für Missbrauchs-/Plausibilitätsprüfung. Wird beim Beenden der Sitzung auf NULL gesetzt.';

-- ---------------------------------------------------------------------------
-- reports — COMMUNITY-Meldungen (§35)
-- ---------------------------------------------------------------------------
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.report_categories (id) ON DELETE RESTRICT,

  scope public.report_scope NOT NULL,
  status public.report_status NOT NULL DEFAULT 'ACTIVE',

  -- GTFS-Referenzen als Text (siehe ADR 4 in IMPLEMENTATION_PLAN.md).
  agency_id text,
  route_id text,
  trip_id text,
  service_date date,
  direction_id smallint,
  vehicle_type text,

  stop_id text,
  next_stop_id text,

  -- Auf ~100 m gerundete Position (§15/§23).
  location geography(Point, 4326),
  location_lv95 geometry(Point, 2056),

  message text,

  -- Trust Score 0..100 (§19), wird bei jeder Stimme neu berechnet.
  confidence smallint NOT NULL DEFAULT 40 CHECK (confidence BETWEEN 0 AND 100),
  upvotes integer NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  downvotes integer NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  flags_count integer NOT NULL DEFAULT 0 CHECK (flags_count >= 0),

  trip_session_id uuid REFERENCES public.trip_sessions (id) ON DELETE SET NULL,
  -- Ergebnis der GPS-Plausibilitätsprüfung zum Zeitpunkt der Erstellung.
  gps_plausibility numeric(3, 2) NOT NULL DEFAULT 1.0
    CHECK (gps_plausibility BETWEEN 0 AND 1),

  -- Idempotenzschlüssel der Offline-Queue (§39).
  client_report_id uuid,

  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  removal_reason text,

  CONSTRAINT reports_message_length CHECK (message IS NULL OR char_length(message) <= 280),
  CONSTRAINT reports_scope_reference CHECK (
    (scope = 'VEHICLE_TRIP' AND trip_id IS NOT NULL)
    OR (scope IN ('STOP', 'STATION') AND stop_id IS NOT NULL)
    OR (scope = 'ROUTE_SEGMENT' AND (route_id IS NOT NULL OR stop_id IS NOT NULL))
    OR (scope = 'NETWORK')
  ),
  CONSTRAINT reports_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX reports_client_id_unique
  ON public.reports (user_id, client_report_id) WHERE client_report_id IS NOT NULL;

-- Zugriffspfade der App:
CREATE INDEX reports_trip_idx
  ON public.reports (trip_id, service_date, created_at DESC)
  WHERE status = 'ACTIVE';
CREATE INDEX reports_stop_idx
  ON public.reports (stop_id, created_at DESC) WHERE status = 'ACTIVE';
CREATE INDEX reports_route_idx
  ON public.reports (route_id, created_at DESC) WHERE status = 'ACTIVE';
CREATE INDEX reports_location_idx
  ON public.reports USING gist (location) WHERE status = 'ACTIVE';
CREATE INDEX reports_user_created_idx ON public.reports (user_id, created_at DESC);
-- Für den Ablauf-Job (§17):
CREATE INDEX reports_expiry_idx ON public.reports (expires_at) WHERE status = 'ACTIVE';
-- Für die Moderations-Queue (§32):
CREATE INDEX reports_moderation_idx
  ON public.reports (created_at DESC)
  WHERE status = 'PENDING_REVIEW' OR flags_count > 0;
CREATE INDEX reports_category_created_idx ON public.reports (category_id, created_at DESC);

COMMENT ON TABLE public.reports IS
  'Community-Meldungen. Offizielle Meldungen liegen getrennt in transit.service_alerts (§7).';

-- ---------------------------------------------------------------------------
-- report_votes (§18) — eine Stimme pro Nutzer und Meldung
-- ---------------------------------------------------------------------------
CREATE TABLE public.report_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  vote smallint NOT NULL CHECK (vote IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, user_id)
);

CREATE INDEX report_votes_user_idx ON public.report_votes (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- report_flags — Missbrauchsmeldungen
-- ---------------------------------------------------------------------------
CREATE TABLE public.report_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reason public.flag_reason NOT NULL,
  note text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, user_id),
  CONSTRAINT report_flags_note_length CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX report_flags_open_idx ON public.report_flags (created_at DESC) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- user_reputation_events (§20)
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_reputation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  delta integer NOT NULL,
  report_id uuid REFERENCES public.reports (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reputation_events_user_idx ON public.user_reputation_events (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- abuse_signals (§21) — Protokoll der Missbrauchserkennung
-- ---------------------------------------------------------------------------
CREATE TABLE public.abuse_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  device_install_id uuid,
  -- IP wird als Hash gespeichert (Pseudonymisierung, §23).
  ip_hash text,
  signal text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('BLOCK', 'FLAG')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX abuse_signals_user_idx ON public.abuse_signals (user_id, created_at DESC);
CREATE INDEX abuse_signals_created_idx ON public.abuse_signals (created_at DESC);

COMMENT ON COLUMN public.abuse_signals.ip_hash IS
  'HMAC der IP-Adresse mit serverseitigem Schlüssel. Klartext-IPs werden nicht gespeichert.';

-- ---------------------------------------------------------------------------
-- trip_follows (§24/§25)
-- ---------------------------------------------------------------------------
CREATE TABLE public.trip_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  trip_id text NOT NULL,
  service_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Follow endet automatisch nach Fahrtende (§25).
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, trip_id, service_date)
);

CREATE INDEX trip_follows_trip_idx ON public.trip_follows (trip_id, service_date, expires_at);

-- ---------------------------------------------------------------------------
-- notification_queue — Outbox für Push (§24)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.reports (id) ON DELETE CASCADE,
  alert_id uuid,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Verhindert Push-Spam: dieselbe Meldung erreicht einen Nutzer nur einmal (§24).
  UNIQUE (user_id, report_id, notification_type)
);

CREATE INDEX notification_queue_pending_idx
  ON public.notification_queue (scheduled_at) WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
CREATE TRIGGER report_categories_set_updated_at
  BEFORE UPDATE ON public.report_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER reports_set_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER report_votes_set_updated_at
  BEFORE UPDATE ON public.report_votes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
