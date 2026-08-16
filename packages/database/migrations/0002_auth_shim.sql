-- 0002_auth_shim.sql
--
-- Supabase stellt das Schema `auth` samt `auth.users`, `auth.uid()` und
-- `auth.role()` bereit. Damit dieselben Migrationen auch gegen ein blankes
-- PostgreSQL laufen (lokale Entwicklung, CI-Integrationstests), wird hier ein
-- minimaler Ersatz angelegt — aber ausschliesslich dann, wenn er fehlt.
--
-- WICHTIG: Auf Supabase verändert diese Migration nichts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    EXECUTE 'CREATE SCHEMA auth';
    COMMENT ON SCHEMA auth IS
      'Lokaler Ersatz für das Supabase-Auth-Schema. In Produktion von Supabase verwaltet.';
  END IF;
END
$$;

-- Minimaler Ersatz für auth.users. Enthält bewusst nur die Spalten, die die
-- Anwendung referenziert; Supabase' echte Tabelle hat deutlich mehr.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- auth.uid() liefert die ID des aktuellen Nutzers aus dem JWT-Claim.
-- Supabase definiert die Funktion bereits; die lokale Variante liest denselben
-- GUC (`request.jwt.claims`), den auch PostgREST setzt.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;
