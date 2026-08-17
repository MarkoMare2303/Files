-- ---------------------------------------------------------------------------
-- 0011_departure_display
--
-- Zwei Korrekturen an `transit.departures()`, die beide erst mit echten
-- Schweizer GTFS-Daten sichtbar werden.
--
-- 1) STATIONSNAME STATT KANTENNAME
--
--    Im Schweizer Datensatz zeigt `stop_times.stop_id` auf die Kante bzw. das
--    Gleis, nicht auf die Station: `8503000:0:31` mit dem Namen
--    „Zürich HB, Gleis 31". Eine Abfahrtstafel, die das so ausgibt, wiederholt
--    in jeder Zeile den Bahnhofsnamen und zeigt die Gleisnummer zweimal.
--    Richtig ist der Name der Station (`parent_station`) plus die
--    Gleisangabe im eigenen Feld.
--
--    Fällt die Kante ohne Elternstation an (kommt bei Bushaltestellen vor),
--    bleibt es beim eigenen Namen.
--
-- 2) KEINE ABFAHRT AM ENDHALT
--
--    Am letzten Halt einer Fahrt steigt niemand mehr ein. Saubere Feeds
--    markieren das mit `pickup_type = 1`, aber verlassen kann man sich darauf
--    nicht — in mehreren Schweizer Teilfeeds fehlt die Angabe. Ohne diesen
--    Filter erscheint in Zürich HB eine Zeile „IC 3 → Zürich HB", also eine
--    Fahrt, die dort endet und nicht abfährt.
--
--    Der Ausschluss über `stop_sequence < max(stop_sequence)` ist unabhängig
--    von der Datenqualität des Feeds.
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
    -- (1) Station bevorzugen, Kante nur als Rückfall.
    COALESCE(parent.name, stop.name) AS stop_name,
    -- Gleisangabe ebenfalls von der Kante, falls sie dort steht.
    COALESCE(stop.platform_code, parent.platform_code) AS platform_code,
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
  LEFT JOIN transit.stops parent
    ON parent.feed_id = feed.id AND parent.stop_id = stop.parent_station
  JOIN transit.routes r ON r.feed_id = feed.id AND r.route_id = t.route_id
  LEFT JOIN transit.agencies a ON a.feed_id = feed.id AND a.agency_id = r.agency_id
  WHERE st.stop_id = ANY (p_stop_ids)
    AND st.departure_seconds IS NOT NULL
    AND st.pickup_type <> 1
    -- (2) Endhalt ausschliessen, unabhängig von pickup_type.
    AND st.stop_sequence < (
      SELECT max(last.stop_sequence)
      FROM transit.stop_times last
      WHERE last.feed_id = feed.id AND last.trip_id = st.trip_id
    )
    AND st.departure_seconds BETWEEN sv.secs - 60 AND sv.secs + p_window_minutes * 60
  ORDER BY scheduled_departure
  LIMIT p_limit
$$;

COMMENT ON FUNCTION transit.departures(text[], timestamptz, integer, integer) IS
  'Abfahrtstafel einer Station. Liefert den Stationsnamen (nicht den Kantennamen) und schliesst den Endhalt aus.';
