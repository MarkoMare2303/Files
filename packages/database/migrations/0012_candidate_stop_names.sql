-- ---------------------------------------------------------------------------
-- 0012_candidate_stop_names
--
-- `transit.find_trip_candidates()` lieferte für „letzter Halt" und „nächster
-- Halt" den Namen der Kante statt den der Station: im Schweizer Datensatz also
-- „Lenzburg, Kante 1" statt „Lenzburg". Die Fahrtenerkennung zeigt genau
-- diese beiden Namen im Vorschlag an — und ein Vorschlag, der so aussieht,
-- wirkt kaputt.
--
-- Identisch zu 0008, nur mit dem Rückgriff auf `parent_station`. Die
-- Funktionssignatur bleibt unverändert.
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
    SELECT st.stop_id, COALESCE(sp.name, s.name) AS name, st.stop_sequence, st.departure_seconds,
           ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lon
    FROM transit.stop_times st
    JOIN transit.stops s ON s.feed_id = v_feed AND s.stop_id = st.stop_id
    LEFT JOIN transit.stops sp ON sp.feed_id = v_feed AND sp.stop_id = s.parent_station
    WHERE st.feed_id = v_feed AND st.trip_id = e.trip_id
      AND st.departure_seconds IS NOT NULL
      AND st.departure_seconds <= e.secs
    ORDER BY st.stop_sequence DESC
    LIMIT 1
  ) prev ON true
  LEFT JOIN LATERAL (
    SELECT st.stop_id, COALESCE(sp.name, s.name) AS name, st.stop_sequence, st.arrival_seconds,
           ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lon
    FROM transit.stop_times st
    JOIN transit.stops s ON s.feed_id = v_feed AND s.stop_id = st.stop_id
    LEFT JOIN transit.stops sp ON sp.feed_id = v_feed AND sp.stop_id = s.parent_station
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
