-- 0001_extensions.sql
-- Basiserweiterungen. Auf Supabase sind postgis/pgcrypto bereits verfügbar,
-- CREATE EXTENSION IF NOT EXISTS ist dort ein No-Op.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Fuzzy-Suche für Haltestellen-/Liniennamen (§27)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Diakritika-unabhängige Suche: "Zurich" findet "Zürich", "Geneve" findet "Genève"
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Eigene Schemas: Fahrplandaten getrennt von Anwendungsdaten.
CREATE SCHEMA IF NOT EXISTS transit;

COMMENT ON SCHEMA transit IS
  'Importierte ÖV-Daten (GTFS Static, GTFS Realtime, Service Alerts). Wird zyklisch komplett ersetzt.';

-- unaccent ist per Definition STABLE, nicht IMMUTABLE, und kann deshalb nicht
-- direkt in einem Index verwendet werden. Dieser IMMUTABLE-Wrapper macht das
-- möglich; er ist an die aktuell installierte unaccent-Konfiguration gebunden.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Normalisierte Suchform: klein, ohne Diakritika, ohne Mehrfach-Leerzeichen.
CREATE OR REPLACE FUNCTION public.search_normalize(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT regexp_replace(lower(public.immutable_unaccent($1)), '\s+', ' ', 'g') $$;
