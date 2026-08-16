-- 0005_transit_realtime.sql
-- GTFS-Realtime (Trip Updates) und offizielle Service Alerts.
--
-- Diese Tabellen sind bewusst NICHT feed-versioniert: Echtzeitdaten beziehen
-- sich immer auf den gerade aktiven Fahrplan und werden laufend überschrieben.
-- Identifikation der Fahrt nach GTFS-RT-Konvention: trip_id + start_date.

CREATE TYPE transit.schedule_relationship AS ENUM (
  'SCHEDULED', 'ADDED', 'UNSCHEDULED', 'CANCELED', 'DUPLICATED', 'DELETED', 'REPLACEMENT'
);

CREATE TYPE transit.alert_severity AS ENUM ('UNKNOWN', 'INFO', 'WARNING', 'SEVERE');

-- ---------------------------------------------------------------------------
-- realtime_trip_updates
-- ---------------------------------------------------------------------------
CREATE TABLE transit.realtime_trip_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL,
  -- Betriebstag der Fahrt (GTFS-RT TripDescriptor.start_date).
  start_date date NOT NULL,
  route_id text,
  direction_id smallint,
  schedule_relationship transit.schedule_relationship NOT NULL DEFAULT 'SCHEDULED',

  -- Fahrzeugkennung, sofern der Feed sie liefert. In der Schweiz oft leer —
  -- deshalb ist die eigene Fahrtenerkennung nötig (§9).
  vehicle_id text,
  vehicle_label text,

  -- Aktuelle Gesamtverspätung in Sekunden (positiv = später).
  delay_seconds integer,
  -- Zeitstempel des Feeds (nicht der Empfangszeitpunkt).
  feed_timestamp timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (trip_id, start_date)
);

CREATE INDEX rt_trip_updates_received_idx ON transit.realtime_trip_updates (received_at DESC);
CREATE INDEX rt_trip_updates_route_idx ON transit.realtime_trip_updates (route_id, start_date);
CREATE INDEX rt_trip_updates_cancelled_idx
  ON transit.realtime_trip_updates (start_date)
  WHERE schedule_relationship = 'CANCELED';

-- ---------------------------------------------------------------------------
-- realtime_stop_time_updates
-- ---------------------------------------------------------------------------
CREATE TABLE transit.realtime_stop_time_updates (
  trip_update_id uuid NOT NULL
    REFERENCES transit.realtime_trip_updates (id) ON DELETE CASCADE,
  stop_sequence integer NOT NULL,
  stop_id text,
  arrival_time timestamptz,
  arrival_delay integer,
  departure_time timestamptz,
  departure_delay integer,
  schedule_relationship transit.schedule_relationship NOT NULL DEFAULT 'SCHEDULED',
  PRIMARY KEY (trip_update_id, stop_sequence)
);

CREATE INDEX rt_stop_time_updates_stop_idx
  ON transit.realtime_stop_time_updates (stop_id, departure_time);

-- ---------------------------------------------------------------------------
-- service_alerts — OFFIZIELLE Meldungen (§7)
--
-- Strikt getrennt von public.reports (Community). Die Trennung ist strukturell,
-- nicht nur konventionell: eine Verwechslung ist damit technisch ausgeschlossen.
-- ---------------------------------------------------------------------------
CREATE TABLE transit.service_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stabile ID aus dem Feed (GTFS-RT FeedEntity.id).
  alert_id text NOT NULL UNIQUE,
  cause text,
  effect text,
  severity transit.alert_severity NOT NULL DEFAULT 'UNKNOWN',

  -- Mehrsprachige Texte als {"de": "...", "fr": "...", ...}
  header jsonb NOT NULL,
  description jsonb,
  url text,

  active_from timestamptz,
  active_until timestamptz,

  source text NOT NULL DEFAULT 'opentransportdata.swiss',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Gesetzt, sobald der Alert nicht mehr im Feed enthalten ist.
  removed_at timestamptz,

  CONSTRAINT service_alerts_header_has_de CHECK (header ? 'de' OR header ? 'en')
);

CREATE INDEX service_alerts_active_idx
  ON transit.service_alerts (active_from, active_until) WHERE removed_at IS NULL;
CREATE INDEX service_alerts_updated_idx ON transit.service_alerts (updated_at DESC);

COMMENT ON TABLE transit.service_alerts IS
  'Offizielle Störungsmeldungen der Betreiber. Getrennt von Community-Meldungen (public.reports).';

-- ---------------------------------------------------------------------------
-- service_alert_entities — welche Linien/Halte/Fahrten betroffen sind
-- ---------------------------------------------------------------------------
CREATE TABLE transit.service_alert_entities (
  id bigserial PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES transit.service_alerts (id) ON DELETE CASCADE,
  agency_id text,
  route_id text,
  route_type integer,
  trip_id text,
  stop_id text,
  CONSTRAINT alert_entity_not_empty CHECK (
    agency_id IS NOT NULL OR route_id IS NOT NULL OR route_type IS NOT NULL
    OR trip_id IS NOT NULL OR stop_id IS NOT NULL
  )
);

CREATE INDEX alert_entities_alert_idx ON transit.service_alert_entities (alert_id);
CREATE INDEX alert_entities_route_idx ON transit.service_alert_entities (route_id) WHERE route_id IS NOT NULL;
CREATE INDEX alert_entities_stop_idx ON transit.service_alert_entities (stop_id) WHERE stop_id IS NOT NULL;
CREATE INDEX alert_entities_trip_idx ON transit.service_alert_entities (trip_id) WHERE trip_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- feed_health — Betriebsüberwachung der externen Datenquellen (§43)
-- ---------------------------------------------------------------------------
CREATE TABLE transit.feed_health (
  component text PRIMARY KEY,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  -- Frei nutzbare Kennzahlen (Anzahl Entitäten, Antwortzeit, ...).
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE transit.feed_health IS
  'Zustand der Datenquellen (gtfs_static, gtfs_rt_trip_updates, service_alerts, ojp). Speist /health und das Admin-Dashboard.';
