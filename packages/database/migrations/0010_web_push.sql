-- ---------------------------------------------------------------------------
-- 0010_web_push
--
-- Umstellung von Expo Push auf Web Push (RFC 8030 / VAPID).
--
-- Hintergrund: Das Produkt wird als Progressive Web App ausgeliefert. Der
-- Expo-Push-Service existiert im Browser nicht. Ein Browser-Abo besteht aus
-- drei Teilen:
--   endpoint  — die vom Browser vergebene Zustelladresse (pro Gerät/Profil)
--   p256dh    — öffentlicher Schlüssel des Clients (ECDH, P-256)
--   auth      — geheimes Authentifizierungs-Secret des Abos
--
-- Wichtig: `p256dh` und `auth` sind KEINE Serverschlüssel. Sie gehören dem
-- Browser des Nutzers und dienen ausschliesslich der Ende-zu-Ende-
-- Verschlüsselung der Nutzlast (RFC 8291). Der private VAPID-Schlüssel des
-- Servers wird NICHT in der Datenbank abgelegt, sondern ausschliesslich als
-- Environment-Variable im Worker-Prozess gehalten.
--
-- Migrationsstrategie: additiv. Die Altspalte `expo_push_token` bleibt
-- erhalten, wird aber nullable — dadurch ist die Migration auf einer
-- bestehenden Installation gefahrlos und reversibel.
-- ---------------------------------------------------------------------------

-- 1. Plattform 'web' ergänzen. ALTER TYPE ... ADD VALUE ist idempotent nur
--    mit IF NOT EXISTS; das braucht PostgreSQL 12+ (wir setzen 16 voraus).
ALTER TYPE public.device_platform ADD VALUE IF NOT EXISTS 'web';

-- 2. Web-Push-Felder ergänzen.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS endpoint text,
  ADD COLUMN IF NOT EXISTS p256dh text,
  ADD COLUMN IF NOT EXISTS auth_secret text,
  ADD COLUMN IF NOT EXISTS expiration_time timestamptz,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz;

-- 3. Der Expo-Token ist nicht mehr zwingend.
ALTER TABLE public.push_subscriptions
  ALTER COLUMN expo_push_token DROP NOT NULL;

-- Die alte Längenprüfung würde bei NULL zwar nicht greifen, ist aber
-- irreführend — sie wird durch eine Prüfung ersetzt, die beide Welten kennt.
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_token_length;

-- 4. Genau eine Zustelladresse pro Zeile: entweder Web Push oder Expo.
--    Ohne diese Prüfung könnten halb ausgefüllte Abos entstehen, die der
--    Worker nicht zustellen kann und die niemand aufräumt.
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_transport;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_transport CHECK (
    (
      endpoint IS NOT NULL
      AND p256dh IS NOT NULL
      AND auth_secret IS NOT NULL
      AND char_length(endpoint) BETWEEN 20 AND 2048
      AND char_length(p256dh) BETWEEN 20 AND 256
      AND char_length(auth_secret) BETWEEN 8 AND 64
    )
    OR (
      expo_push_token IS NOT NULL
      AND char_length(expo_push_token) BETWEEN 10 AND 256
    )
  );

-- 5. Ein Endpunkt gehört zu genau einem Abo. Meldet sich derselbe Browser
--    erneut an, wird die Zeile aktualisiert statt dupliziert.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key
  ON public.push_subscriptions (endpoint)
  WHERE endpoint IS NOT NULL;

-- 6. Der Worker sucht ausschliesslich aktive Abos je Nutzer.
CREATE INDEX IF NOT EXISTS push_subscriptions_active_web_idx
  ON public.push_subscriptions (user_id)
  WHERE enabled AND endpoint IS NOT NULL;

COMMENT ON COLUMN public.push_subscriptions.endpoint IS
  'Web-Push-Zustelladresse des Browsers (RFC 8030). Gerätespezifisch, kein Personenbezug im Klartext.';
COMMENT ON COLUMN public.push_subscriptions.p256dh IS
  'Öffentlicher ECDH-Schlüssel des Clients (RFC 8291). Kein Serverschlüssel.';
COMMENT ON COLUMN public.push_subscriptions.auth_secret IS
  'Authentifizierungs-Secret des Abos (RFC 8291). Gehört dem Browser, nicht dem Server.';
COMMENT ON COLUMN public.push_subscriptions.expo_push_token IS
  'Veraltet — nur für Altbestände der nativen App. Neue Abos nutzen endpoint/p256dh/auth_secret.';
