import type { ApiEnv } from '@swissov/config';
import type { Database } from '@swissov/database';
import { JourneyPlanner } from '@swissov/transit';
import type { Cache } from './lib/cache.js';
import type { ErrorTracker } from './lib/observability.js';
import { ConfigService } from './services/config.service.js';
import { FeatureFlagService } from './services/feature-flags.service.js';
import { ProfileService } from './services/profiles.service.js';
import { RealtimeBroadcaster } from './services/realtime.service.js';

/**
 * Anwendungskontext.
 *
 * Wird einmal beim Start aufgebaut und über `fastify.ctx` bereitgestellt.
 * Explizite Übergabe statt globaler Singletons — dadurch lassen sich
 * Integrationstests mit eigener Datenbank und eigenem Cache aufsetzen.
 */
export interface AppContext {
  env: ApiEnv;
  db: Database;
  cache: Cache;
  config: ConfigService;
  flags: FeatureFlagService;
  profiles: ProfileService;
  journeys: JourneyPlanner;
  realtime: RealtimeBroadcaster;
  errors: ErrorTracker;
  /** `shim`: lokales Postgres ohne Supabase-Auth; `supabase`: echtes Auth-Schema. */
  authMode: 'shim' | 'supabase';
}

export interface CreateContextOptions {
  env: ApiEnv;
  db: Database;
  cache: Cache;
  errors: ErrorTracker;
}

export async function createContext(options: CreateContextOptions): Promise<AppContext> {
  const { env, db, cache, errors } = options;

  const authMode = await detectAuthMode(db);
  const config = new ConfigService(db, cache);
  const flags = new FeatureFlagService(db, cache);
  const profiles = new ProfileService(db, env.API_INTERNAL_SECRET, authMode);

  const journeys = new JourneyPlanner({
    db,
    ojpEndpointUrl: env.OJP_ENDPOINT_URL,
    ojpApiKey: env.OJP_API_KEY,
    ojpRequestorRef: env.OJP_REQUESTOR_REF,
    ojpEnabled: await flags.isEnabled('ojp_routing').catch(() => false),
  });

  const realtime = new RealtimeBroadcaster({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  return { env, db, cache, config, flags, profiles, journeys, realtime, errors, authMode };
}

/**
 * Unterscheidet das echte Supabase-Auth-Schema vom lokalen Shim aus
 * Migration 0002. Der Unterschied bestimmt, ob die API beim ersten Login
 * selbst einen `auth.users`-Datensatz anlegen darf.
 */
async function detectAuthMode(db: Database): Promise<'shim' | 'supabase'> {
  const row = await db.queryOne<{ is_supabase: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'encrypted_password'
     ) AS is_supabase`,
  );
  return row?.is_supabase ? 'supabase' : 'shim';
}
