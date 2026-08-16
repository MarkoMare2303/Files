-- 0004_transit_static.sql
-- GTFS-Static-Daten. Jede Zeile gehört zu einer Import-Version (`feed_id`);
-- dadurch kann ein neuer Fahrplan im Hintergrund importiert und anschliessend
-- atomar aktiviert werden, ohne Ausfallzeit.

CREATE TYPE transit.import_status AS ENUM (
  'PENDING', 'DOWNLOADING', 'IMPORTING', 'ACTIVE', 'SUPERSEDED', 'FAILED'
);

-- ---------------------------------------------------------------------------
-- gtfs_imports — Versionierung
-- ---------------------------------------------------------------------------
CREATE TABLE transit.gtfs_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL,
  feed_version text,
  feed_start_date date,
  feed_end_date date,
  -- SHA-256 des heruntergeladenen Archivs: identische Feeds werden übersprungen.
  checksum text,
  status transit.import_status NOT NULL DEFAULT 'PENDING',
  error text,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  activated_at timestamptz
);

-- Höchstens eine aktive Feed-Version.
CREATE UNIQUE INDEX gtfs_imports_single_active
  ON transit.gtfs_imports ((status)) WHERE status = 'ACTIVE';
CREATE INDEX gtfs_imports_started_idx ON transit.gtfs_imports (started_at DESC);
CREATE INDEX gtfs_imports_checksum_idx ON transit.gtfs_imports (checksum) WHERE checksum IS NOT NULL;

COMMENT ON TABLE transit.gtfs_imports IS
  'Eine Zeile pro GTFS-Import. Der Datenzugriff filtert immer auf die Version mit status = ACTIVE.';

-- ---------------------------------------------------------------------------
-- feed_info
-- ---------------------------------------------------------------------------
CREATE TABLE transit.feed_info (
  feed_id uuid PRIMARY KEY REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  publisher_name text,
  publisher_url text,
  lang text,
  start_date date,
  end_date date,
  version text
);

-- ---------------------------------------------------------------------------
-- agencies
-- ---------------------------------------------------------------------------
CREATE TABLE transit.agencies (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  agency_id text NOT NULL,
  name text NOT NULL,
  url text,
  timezone text NOT NULL DEFAULT 'Europe/Zurich',
  lang text,
  phone text,
  PRIMARY KEY (feed_id, agency_id)
);

CREATE INDEX agencies_name_trgm_idx
  ON transit.agencies USING gin (public.search_normalize(name) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- routes
-- ---------------------------------------------------------------------------
CREATE TABLE transit.routes (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  route_id text NOT NULL,
  agency_id text,
  short_name text,
  long_name text,
  description text,
  -- GTFS route_type inkl. der erweiterten Typen (100–1700), die der
  -- Schweizer Datensatz verwendet.
  route_type integer NOT NULL,
  color text,
  text_color text,
  sort_order integer,
  PRIMARY KEY (feed_id, route_id),
  FOREIGN KEY (feed_id, agency_id) REFERENCES transit.agencies (feed_id, agency_id) ON DELETE SET NULL
);

CREATE INDEX routes_feed_type_idx ON transit.routes (feed_id, route_type);
CREATE INDEX routes_short_name_idx ON transit.routes (feed_id, short_name);
CREATE INDEX routes_search_idx
  ON transit.routes USING gin (
    public.search_normalize(coalesce(short_name, '') || ' ' || coalesce(long_name, '')) gin_trgm_ops
  );

-- ---------------------------------------------------------------------------
-- calendar / calendar_dates
-- ---------------------------------------------------------------------------
CREATE TABLE transit.calendar (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  service_id text NOT NULL,
  monday boolean NOT NULL DEFAULT false,
  tuesday boolean NOT NULL DEFAULT false,
  wednesday boolean NOT NULL DEFAULT false,
  thursday boolean NOT NULL DEFAULT false,
  friday boolean NOT NULL DEFAULT false,
  saturday boolean NOT NULL DEFAULT false,
  sunday boolean NOT NULL DEFAULT false,
  start_date date NOT NULL,
  end_date date NOT NULL,
  PRIMARY KEY (feed_id, service_id)
);

CREATE INDEX calendar_range_idx ON transit.calendar (feed_id, start_date, end_date);

CREATE TABLE transit.calendar_dates (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  service_id text NOT NULL,
  date date NOT NULL,
  -- 1 = Betrieb hinzugefügt, 2 = Betrieb entfällt
  exception_type smallint NOT NULL CHECK (exception_type IN (1, 2)),
  PRIMARY KEY (feed_id, service_id, date)
);

CREATE INDEX calendar_dates_lookup_idx ON transit.calendar_dates (feed_id, date, exception_type);

-- ---------------------------------------------------------------------------
-- shapes
-- ---------------------------------------------------------------------------
CREATE TABLE transit.shapes (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  shape_id text NOT NULL,
  -- WGS84 für Ausgabe an Clients
  geom geometry(LineString, 4326) NOT NULL,
  -- LV95 (EPSG:2056): metrisches Schweizer Bezugssystem. Alle Distanz- und
  -- Projektionsrechnungen laufen hierauf — planar, exakt in Metern, schnell.
  geom_lv95 geometry(LineString, 2056) NOT NULL,
  length_m double precision NOT NULL,
  PRIMARY KEY (feed_id, shape_id)
);

CREATE INDEX shapes_geom_lv95_idx ON transit.shapes USING gist (geom_lv95);
CREATE INDEX shapes_geom_idx ON transit.shapes USING gist (geom);

COMMENT ON COLUMN transit.shapes.geom_lv95 IS
  'Streckenverlauf in EPSG:2056 (CH1903+/LV95). Basis für ST_Distance/ST_LineLocatePoint in Metern.';

-- ---------------------------------------------------------------------------
-- stops
-- ---------------------------------------------------------------------------
CREATE TABLE transit.stops (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  stop_id text NOT NULL,
  code text,
  name text NOT NULL,
  description text,
  geom geography(Point, 4326) NOT NULL,
  geom_lv95 geometry(Point, 2056) NOT NULL,
  location_type smallint NOT NULL DEFAULT 0 CHECK (location_type BETWEEN 0 AND 4),
  parent_station text,
  platform_code text,
  timezone text,
  wheelchair_boarding smallint NOT NULL DEFAULT 0 CHECK (wheelchair_boarding BETWEEN 0 AND 2),
  PRIMARY KEY (feed_id, stop_id)
);

CREATE INDEX stops_geom_idx ON transit.stops USING gist (geom);
CREATE INDEX stops_geom_lv95_idx ON transit.stops USING gist (geom_lv95);
CREATE INDEX stops_parent_idx ON transit.stops (feed_id, parent_station) WHERE parent_station IS NOT NULL;
CREATE INDEX stops_name_trgm_idx
  ON transit.stops USING gin (public.search_normalize(name) gin_trgm_ops);
CREATE INDEX stops_code_idx ON transit.stops (feed_id, code) WHERE code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
CREATE TABLE transit.trips (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  trip_id text NOT NULL,
  route_id text NOT NULL,
  service_id text NOT NULL,
  headsign text,
  short_name text,
  direction_id smallint CHECK (direction_id IN (0, 1)),
  block_id text,
  shape_id text,
  wheelchair_accessible smallint,
  bikes_allowed smallint,

  -- Denormalisiert beim Import: erspart im heissen Pfad (Fahrtenerkennung,
  -- Abfahrtstafeln) je einen Aggregat-Join auf stop_times.
  start_seconds integer,
  end_seconds integer,
  first_stop_id text,
  last_stop_id text,
  first_stop_name text,
  last_stop_name text,
  stop_count integer NOT NULL DEFAULT 0,

  PRIMARY KEY (feed_id, trip_id),
  FOREIGN KEY (feed_id, route_id) REFERENCES transit.routes (feed_id, route_id) ON DELETE CASCADE
);

CREATE INDEX trips_route_idx ON transit.trips (feed_id, route_id);
CREATE INDEX trips_service_idx ON transit.trips (feed_id, service_id);
CREATE INDEX trips_shape_idx ON transit.trips (feed_id, shape_id) WHERE shape_id IS NOT NULL;
-- Zentraler Index der Fahrtenerkennung: aktive Fahrten in einem Zeitfenster.
CREATE INDEX trips_window_idx ON transit.trips (feed_id, start_seconds, end_seconds);

COMMENT ON COLUMN transit.trips.start_seconds IS
  'Abfahrt am ersten Halt in Sekunden seit Betriebstagsbeginn. Kann > 86400 sein (Nachtverkehr).';

-- ---------------------------------------------------------------------------
-- stop_times
--
-- Grösste Tabelle des Systems (Schweizer Gesamtfeed: ~15 Mio. Zeilen).
-- Deshalb: schmale Spalten, Integer-Zeiten statt interval/text.
-- ---------------------------------------------------------------------------
CREATE TABLE transit.stop_times (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  trip_id text NOT NULL,
  stop_sequence integer NOT NULL,
  stop_id text NOT NULL,
  arrival_seconds integer,
  departure_seconds integer,
  stop_headsign text,
  pickup_type smallint NOT NULL DEFAULT 0,
  drop_off_type smallint NOT NULL DEFAULT 0,
  shape_dist_traveled double precision,
  PRIMARY KEY (feed_id, trip_id, stop_sequence)
);

-- Abfahrtstafel: „nächste Abfahrten an Haltestelle X ab Sekunde S".
CREATE INDEX stop_times_departures_idx
  ON transit.stop_times (feed_id, stop_id, departure_seconds);

COMMENT ON TABLE transit.stop_times IS
  'Halte je Fahrt. Zeiten in Sekunden seit Betriebstagsbeginn (Werte ≥ 86400 = Folgetag).';

-- ---------------------------------------------------------------------------
-- transfers (optional im Feed; für Anschlussbewertung)
-- ---------------------------------------------------------------------------
CREATE TABLE transit.transfers (
  feed_id uuid NOT NULL REFERENCES transit.gtfs_imports (id) ON DELETE CASCADE,
  from_stop_id text NOT NULL,
  to_stop_id text NOT NULL,
  transfer_type smallint NOT NULL DEFAULT 0,
  min_transfer_time integer,
  PRIMARY KEY (feed_id, from_stop_id, to_stop_id)
);
