-- 0008_geo_functions.sql
--
-- Geo- und Fahrplanabfragen (§37). Diese laufen bewusst in der Datenbank:
-- der Client durchsucht niemals vollständige Tabellen, und die schweizweiten
-- Datenmengen (Millionen stop_times) bleiben serverseitig.

-- ---------------------------------------------------------------------------
-- Aktive Feed-Version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transit.active_feed_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM transit.gtfs_imports WHERE status = 'ACTIVE' LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- Betriebstag + Sekunden → absoluter Zeitpunkt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transit.service_time(p_service_date date, p_seconds integer)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_seconds IS NULL THEN NULL
    ELSE (p_service_date::timestamp + make_interval(secs => p_seconds)) AT TIME ZONE 'Europe/Zurich'
  END
$$;

COMMENT ON FUNCTION transit.service_time IS
  'Rechnet GTFS-Zeiten (Sekunden seit Betriebstagsbeginn, ggf. > 86400) in absolute Zeitpunkte um.';

-- ---------------------------------------------------------------------------
-- Aktive Services an einem Betriebstag (calendar + calendar_dates)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transit.active_service_ids(p_feed_id uuid, p_service_date date)
RETURNS TABLE (service_id text)
LANGUAGE sql
STABLE
AS $$
  -- Regulärer Kalender, abzüglich expliziter Ausnahmen (exception_type = 2)
  SELECT c.service_id
  FROM transit.calendar c
  WHERE c.feed_id = p_feed_id
    AND p_service_date BETWEEN c.start_date AND c.end_date
    AND CASE EXTRACT(ISODOW FROM p_service_date)
          WHEN 1 THEN c.monday
          WHEN 2 THEN c.tuesday
          WHEN 3 THEN c.wednesday
          WHEN 4 THEN c.thursday
          WHEN 5 THEN c.friday
          WHEN 6 THEN c.saturday
          ELSE c.sunday
        END
    AND NOT EXISTS (
      SELECT 1 FROM transit.calendar_dates cd
      WHERE cd.feed_id = p_feed_id
        AND cd.service_id = c.service_id
        AND cd.date = p_service_date
        AND cd.exception_type = 2
    )
  UNION
  -- Zusätzlich eingelegte Betriebstage (exception_type = 1)
  SELECT cd.service_id
  FROM transit.calendar_dates cd
  WHERE cd.feed_id = p_feed_id
    AND cd.date = p_service_date
    AND cd.exception_type = 1
$$;

-- ---------------------------------------------------------------------------
-- Haltestellen in der Nähe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transit.stops_nearby(
  p_lat double precision,
  p_lon double precision,
  p_radius_m integer DEFAULT 800,
  p_limit integer DEFAULT 25,
  -- true: nur Stationen/eigenständige Halte, keine einzelnen Kanten/Gleise
  p_parents_only boolean DEFAULT true
)
RETURNS TABLE (
  stop_id text,
  name text,
  code text,
  lat double precision,
  lon double precision,
  location_type smallint,
  parent_station text,
  platform_code text,
  wheelchair_boarding smallint,
  distance_m double precision
)
LANGUAGE sql
STABLE
AS $$
  WITH feed AS (SELECT transit.active_feed_id() AS id),
  origin AS (SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography AS g)
  SELECT
    s.stop_id,
    s.name,
    s.code,
    ST_Y(s.geom::geometry) AS lat,
    ST_X(s.geom::geometry) AS lon,
    s.location_type,
    s.parent_station,
    s.platform_code,
    s.wheelchair_boarding,
    ST_Distance(s.geom, origin.g) AS distance_m
  FROM transit.stops s, feed, origin
  WHERE s.feed_id = feed.id
    AND ST_DWithin(s.geom, origin.g, p_radius_m)
    AND (
      NOT p_parents_only
      OR s.location_type = 1
      OR (s.location_type = 0 AND s.parent_station IS NULL)
    )
  ORDER BY s.geom <-> origin.g
  LIMIT p_limit
$$;

-- ---------------------------------------------------------------------------
-- Abfahrtstafel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transit.departures(
  p_stop_ids text[],
  p_at timestamptz DEFAULT now(),
  p_window_minutes integer DEFAULT 120,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  trip_id text,
  service_date text,
  stop_id text,
  stop_name text,
  platform_code text,
  stop_sequence integer,
  route_id text,
  route_short_name text,
  route_long_name text,
  route_color text,
  route_type integer,
  agency_id text,
  agency_name text,
  headsign text,
  direction_id smallint,
  destination_name text,
  scheduled_departure timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH feed AS (SELECT transit.active_feed_id() AS id),
  -- Kandidaten-Betriebstage: heute und gestern (Fahrten über Mitternacht).
  windows AS (
    SELECT
      d.service_date,
      EXTRACT(EPOCH FROM (p_at AT TIME ZONE 'Europe/Zurich') - d.service_date::timestamp)::integer AS secs
    FROM (
      SELECT (p_at AT TIME ZONE 'Europe/Zurich')::date AS service_date
      UNION ALL
      SELECT ((p_at AT TIME ZONE 'Europe/Zurich')::date - 1)
    ) d
  ),
  services AS (
    SELECT w.service_date, w.secs, s.service_id
    FROM windows w, feed
    CROSS JOIN LATERAL transit.active_service_ids(feed.id, w.service_date) s
  )
  SELECT
    st.trip_id,
    sv.service_date::text,
    st.stop_id,
    stop.name AS stop_name,
    stop.platform_code,
    st.stop_sequence,
    t.route_id,
    r.short_name AS route_short_name,
    r.long_name AS route_long_name,
    r.color AS route_color,
    r.route_type,
    r.agency_id,
    a.name AS agency_name,
    COALESCE(st.stop_headsign, t.headsign) AS headsign,
    t.direction_id,
    t.last_stop_name AS destination_name,
    transit.service_time(sv.service_date, st.departure_seconds) AS scheduled_departure
  FROM services sv
  JOIN feed ON true
  JOIN transit.trips t ON t.feed_id = feed.id AND t.service_id = sv.service_id
  JOIN transit.stop_times st ON st.feed_id = feed.id AND st.trip_id = t.trip_id
  JOIN transit.stops stop ON stop.feed_id = feed.id AND stop.stop_id = st.stop_id
  JOIN transit.routes r ON r.feed_id = feed.id AND r.route_id = t.route_id
  LEFT JOIN transit.agencies a ON a.feed_id = feed.id AND a.agency_id = r.agency_id
  WHERE st.stop_id = ANY (p_stop_ids)
    AND st.departure_seconds IS NOT NULL
    AND st.pickup_type <> 1
    AND st.departure_seconds BETWEEN sv.secs - 60 AND sv.secs + p_window_minutes * 60
  ORDER BY scheduled_departure
  LIMIT p_limit
$$;

-- ---------------------------------------------------------------------------
-- Kandidatenfahrten für die Fahrtenerkennung (§10)
--
-- Vorgehen:
--   1. Streckenverläufe im Umkreis finden (GIST-Index auf geom_lv95).
--   2. Fahrten dieser Strecken auf aktive Betriebstage einschränken.
--   3. Zeitfenster über die denormalisierten start_seconds/end_seconds.
--   4. Projektion, vorherigen/nächsten Halt und Sollposition berechnen.
--
-- Die eigentliche Bewertung (Confidence Score) passiert in @swissov/shared —
-- hier wird nur die Datengrundlage geliefert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transit.find_trip_candidates(
  p_lat double precision,
  p_lon double precision,
  p_at timestamptz DEFAULT now(),
  p_radius_m integer DEFAULT 1200,
  p_limit integer DEFAULT 25,
  -- Optionale frühere Beobachtung für die Fortschrittsbewertung.
  p_prev_lat double precision DEFAULT NULL,
  p_prev_lon double precision DEFAULT NULL,
  -- Optionaler Filter auf GTFS route_type (NULL = alle Verkehrsmittel).
  p_route_types integer[] DEFAULT NULL
)
RETURNS TABLE (
  trip_id text,
  service_date text,
  route_id text,
  route_short_name text,
  route_long_name text,
  route_color text,
  route_type integer,
  agency_id text,
  agency_name text,
  headsign text,
  direction_id smallint,
  origin_name text,
  destination_name text,
  stop_count integer,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  distance_m double precision,
  fraction double precision,
  bearing_deg double precision,
  shape_length_m double precision,
  prev_distance_m double precision,
  prev_fraction double precision,
  prev_stop_id text,
  prev_stop_name text,
  prev_stop_sequence integer,
  prev_stop_lat double precision,
  prev_stop_lon double precision,
  prev_stop_departure timestamptz,
  next_stop_id text,
  next_stop_name text,
  next_stop_sequence integer,
  next_stop_lat double precision,
  next_stop_lon double precision,
  next_stop_arrival timestamptz,
  expected_lat double precision,
  expected_lon double precision
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_feed uuid := transit.active_feed_id();
  v_point geometry(Point, 2056);
  v_prev_point geometry(Point, 2056);
BEGIN
  IF v_feed IS NULL THEN
    RETURN;
  END IF;

  v_point := ST_Transform(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), 2056);
  IF p_prev_lat IS NOT NULL AND p_prev_lon IS NOT NULL THEN
    v_prev_point := ST_Transform(ST_SetSRID(ST_MakePoint(p_prev_lon, p_prev_lat), 4326), 2056);
  END IF;

  RETURN QUERY
  WITH windows AS (
    SELECT
      d.service_date,
      EXTRACT(EPOCH FROM (p_at AT TIME ZONE 'Europe/Zurich') - d.service_date::timestamp)::integer AS secs
    FROM (
      SELECT (p_at AT TIME ZONE 'Europe/Zurich')::date AS service_date
      UNION ALL
      SELECT ((p_at AT TIME ZONE 'Europe/Zurich')::date - 1)
    ) d
  ),
  services AS (
    SELECT w.service_date, w.secs, s.service_id
    FROM windows w
    CROSS JOIN LATERAL transit.active_service_ids(v_feed, w.service_date) s
  ),
  -- Strecken im Umkreis. Der GIST-Index macht diesen Schritt selektiv.
  nearby_shapes AS (
    SELECT sh.shape_id, sh.geom_lv95, sh.length_m
    FROM transit.shapes sh
    WHERE sh.feed_id = v_feed
      AND ST_DWithin(sh.geom_lv95, v_point, p_radius_m)
    ORDER BY sh.geom_lv95 <-> v_point
    LIMIT 400
  ),
  candidates AS (
    SELECT
      t.trip_id,
      t.route_id,
      t.direction_id,
      t.headsign,
      t.first_stop_name,
      t.last_stop_name,
      t.stop_count,
      t.start_seconds,
      t.end_seconds,
      sv.service_date,
      sv.secs,
      ns.geom_lv95,
      ns.length_m,
      ST_Distance(ns.geom_lv95, v_point) AS distance_m
    FROM transit.trips t
    JOIN services sv ON sv.service_id = t.service_id
    JOIN nearby_shapes ns ON ns.shape_id = t.shape_id
    WHERE t.feed_id = v_feed
      AND t.start_seconds IS NOT NULL
      AND t.end_seconds IS NOT NULL
      -- 5 Minuten Vorlauf, 15 Minuten Nachlauf (Verspätungen).
      AND sv.secs BETWEEN t.start_seconds - 300 AND t.end_seconds + 900
    ORDER BY ST_Distance(ns.geom_lv95, v_point)
    LIMIT p_limit * 4
  ),
  enriched AS (
    SELECT
      c.*,
      r.short_name AS route_short_name,
      r.long_name AS route_long_name,
      r.color AS route_color,
      r.route_type,
      r.agency_id,
      a.name AS agency_name,
      ST_LineLocatePoint(c.geom_lv95, v_point) AS fraction,
      CASE WHEN v_prev_point IS NULL THEN NULL
           ELSE ST_Distance(c.geom_lv95, v_prev_point) END AS prev_distance_m,
      CASE WHEN v_prev_point IS NULL THEN NULL
           ELSE ST_LineLocatePoint(c.geom_lv95, v_prev_point) END AS prev_fraction
    FROM candidates c
    JOIN transit.routes r ON r.feed_id = v_feed AND r.route_id = c.route_id
    LEFT JOIN transit.agencies a ON a.feed_id = v_feed AND a.agency_id = r.agency_id
    WHERE p_route_types IS NULL OR r.route_type = ANY (p_route_types)
  )
  SELECT
    e.trip_id,
    e.service_date::text,
    e.route_id,
    e.route_short_name,
    e.route_long_name,
    e.route_color,
    e.route_type,
    e.agency_id,
    e.agency_name,
    e.headsign,
    e.direction_id,
    e.first_stop_name AS origin_name,
    e.last_stop_name AS destination_name,
    e.stop_count,
    transit.service_time(e.service_date, e.start_seconds) AS scheduled_start,
    transit.service_time(e.service_date, e.end_seconds) AS scheduled_end,
    e.distance_m,
    e.fraction,
    -- Richtung der Linie an der Projektionsstelle: Azimut zwischen dem
    -- Projektionspunkt und einem Punkt kurz danach, in Grad (0 = Nord).
    degrees(
      ST_Azimuth(
        ST_LineInterpolatePoint(e.geom_lv95, GREATEST(e.fraction - 0.001, 0)),
        ST_LineInterpolatePoint(e.geom_lv95, LEAST(e.fraction + 0.001, 1))
      )
    ) AS bearing_deg,
    e.length_m AS shape_length_m,
    e.prev_distance_m,
    e.prev_fraction,
    prev.stop_id AS prev_stop_id,
    prev.name AS prev_stop_name,
    prev.stop_sequence AS prev_stop_sequence,
    prev.lat AS prev_stop_lat,
    prev.lon AS prev_stop_lon,
    transit.service_time(e.service_date, prev.departure_seconds) AS prev_stop_departure,
    nxt.stop_id AS next_stop_id,
    nxt.name AS next_stop_name,
    nxt.stop_sequence AS next_stop_sequence,
    nxt.lat AS next_stop_lat,
    nxt.lon AS next_stop_lon,
    transit.service_time(e.service_date, nxt.arrival_seconds) AS next_stop_arrival,
    -- Sollposition: zwischen letztem und nächstem Halt zeitanteilig entlang
    -- der Strecke interpoliert.
    CASE
      WHEN prev.stop_id IS NULL OR nxt.stop_id IS NULL THEN NULL
      ELSE ST_Y(ST_Transform(ST_LineInterpolatePoint(e.geom_lv95, LEAST(GREATEST(
        ST_LineLocatePoint(e.geom_lv95, ST_Transform(ST_SetSRID(ST_MakePoint(prev.lon, prev.lat), 4326), 2056))
        + (ST_LineLocatePoint(e.geom_lv95, ST_Transform(ST_SetSRID(ST_MakePoint(nxt.lon, nxt.lat), 4326), 2056))
           - ST_LineLocatePoint(e.geom_lv95, ST_Transform(ST_SetSRID(ST_MakePoint(prev.lon, prev.lat), 4326), 2056)))
          * CASE WHEN nxt.arrival_seconds > prev.departure_seconds
                 THEN (e.secs - prev.departure_seconds)::double precision
                      / (nxt.arrival_seconds - prev.departure_seconds)
                 ELSE 0 END,
        0), 1)), 4326))
    END AS expected_lat,
    CASE
      WHEN prev.stop_id IS NULL OR nxt.stop_id IS NULL THEN NULL
      ELSE ST_X(ST_Transform(ST_LineInterpolatePoint(e.geom_lv95, LEAST(GREATEST(
        ST_LineLocatePoint(e.geom_lv95, ST_Transform(ST_SetSRID(ST_MakePoint(prev.lon, prev.lat), 4326), 2056))
        + (ST_LineLocatePoint(e.geom_lv95, ST_Transform(ST_SetSRID(ST_MakePoint(nxt.lon, nxt.lat), 4326), 2056))
           - ST_LineLocatePoint(e.geom_lv95, ST_Transform(ST_SetSRID(ST_MakePoint(prev.lon, prev.lat), 4326), 2056)))
          * CASE WHEN nxt.arrival_seconds > prev.departure_seconds
                 THEN (e.secs - prev.departure_seconds)::double precision
                      / (nxt.arrival_seconds - prev.departure_seconds)
                 ELSE 0 END,
        0), 1)), 4326))
    END AS expected_lon
  FROM enriched e
  LEFT JOIN LATERAL (
    SELECT st.stop_id, s.name, st.stop_sequence, st.departure_seconds,
           ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lon
    FROM transit.stop_times st
    JOIN transit.stops s ON s.feed_id = v_feed AND s.stop_id = st.stop_id
    WHERE st.feed_id = v_feed AND st.trip_id = e.trip_id
      AND st.departure_seconds IS NOT NULL
      AND st.departure_seconds <= e.secs
    ORDER BY st.stop_sequence DESC
    LIMIT 1
  ) prev ON true
  LEFT JOIN LATERAL (
    SELECT st.stop_id, s.name, st.stop_sequence, st.arrival_seconds,
           ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lon
    FROM transit.stop_times st
    JOIN transit.stops s ON s.feed_id = v_feed AND s.stop_id = st.stop_id
    WHERE st.feed_id = v_feed AND st.trip_id = e.trip_id
      AND st.arrival_seconds IS NOT NULL
      AND st.arrival_seconds > e.secs
    ORDER BY st.stop_sequence ASC
    LIMIT 1
  ) nxt ON true
  ORDER BY e.distance_m
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION transit.find_trip_candidates IS
  'Liefert plausible Fahrten zu einer GPS-Position. Bewertung erfolgt in der Anwendungsschicht (@swissov/shared).';

-- ---------------------------------------------------------------------------
-- Volltext-/Fuzzy-Suche über Haltestellen und Linien (§27)
--
-- Kombiniert drei Verfahren, weil kurze Suchbegriffe („IC 3") gegen lange
-- Zielstrings ("ic 3 zurich hb - basel sbb") mit reiner Trigramm-Ähnlichkeit
-- nie über die Schwelle kommen:
--   • similarity()      — Gesamtähnlichkeit, gut für Tippfehler
--   • word_similarity() — findet den Suchbegriff INNERHALB des Zielstrings
--   • Präfixvergleich ohne Leerzeichen — damit "IC3" die Linie "IC 3" findet
-- Alle drei nutzen den GIN-Trigramm-Index bzw. laufen nur auf der kleinen
-- Linien-Tabelle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transit.search_places(p_query text, p_limit integer DEFAULT 15)
RETURNS TABLE (
  kind text,
  id text,
  name text,
  subtitle text,
  lat double precision,
  lon double precision,
  route_type integer,
  score real
)
LANGUAGE sql
STABLE
AS $$
  WITH feed AS (SELECT transit.active_feed_id() AS id),
  q AS (
    SELECT
      public.search_normalize(p_query) AS term,
      replace(public.search_normalize(p_query), ' ', '') AS compact
  )
  (
    SELECT
      'STOP' AS kind,
      s.stop_id AS id,
      s.name,
      s.code AS subtitle,
      ST_Y(s.geom::geometry) AS lat,
      ST_X(s.geom::geometry) AS lon,
      NULL::integer AS route_type,
      GREATEST(
        similarity(public.search_normalize(s.name), q.term),
        word_similarity(q.term, public.search_normalize(s.name))
      )::real AS score
    FROM transit.stops s, feed, q
    WHERE s.feed_id = feed.id
      AND (s.location_type = 1 OR (s.location_type = 0 AND s.parent_station IS NULL))
      AND (
        public.search_normalize(s.name) % q.term
        OR q.term <% public.search_normalize(s.name)
      )
    ORDER BY score DESC, s.name
    LIMIT p_limit
  )
  UNION ALL
  (
    SELECT
      'ROUTE' AS kind,
      r.route_id AS id,
      COALESCE(r.short_name, r.long_name) AS name,
      COALESCE(r.long_name, a.name) AS subtitle,
      NULL::double precision AS lat,
      NULL::double precision AS lon,
      r.route_type,
      GREATEST(
        similarity(public.search_normalize(COALESCE(r.short_name, '')), q.term),
        word_similarity(
          q.term,
          public.search_normalize(COALESCE(r.short_name, '') || ' ' || COALESCE(r.long_name, ''))
        ),
        -- Exakter Präfixtreffer ohne Leerzeichen wird hoch gewichtet.
        CASE
          WHEN replace(public.search_normalize(COALESCE(r.short_name, '')), ' ', '')
               LIKE q.compact || '%' THEN 1.0
          ELSE 0
        END
      )::real AS score
    FROM transit.routes r
    JOIN feed ON true
    CROSS JOIN q
    LEFT JOIN transit.agencies a ON a.feed_id = feed.id AND a.agency_id = r.agency_id
    WHERE r.feed_id = feed.id
      AND (
        public.search_normalize(COALESCE(r.short_name, '')) % q.term
        OR q.term <% public.search_normalize(
             COALESCE(r.short_name, '') || ' ' || COALESCE(r.long_name, ''))
        OR replace(public.search_normalize(COALESCE(r.short_name, '')), ' ', '')
             LIKE q.compact || '%'
      )
    ORDER BY score DESC
    LIMIT p_limit
  )
$$;
