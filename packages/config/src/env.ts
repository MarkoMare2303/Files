import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Lädt `.env` aus dem nächstgelegenen Verzeichnis, das eine `pnpm-workspace.yaml`
 * enthält (Monorepo-Root), sowie eine App-lokale `.env`, falls vorhanden.
 * Bereits gesetzte Prozess-Variablen haben immer Vorrang (z. B. in CI/Produktion).
 */
export function loadEnvFiles(startDir: string = process.cwd()): void {
  const localEnv = resolve(startDir, '.env');
  if (existsSync(localEnv)) loadDotenv({ path: localEnv });

  let dir = resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      const rootEnv = resolve(dir, '.env');
      if (existsSync(rootEnv)) loadDotenv({ path: rootEnv });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optionalNonEmpty = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

/**
 * Aufzählung, bei der ein leerer Wert „nicht gesetzt" bedeutet.
 *
 * `.env`-Dateien kennen kein „nicht vorhanden": eine Zeile ohne Wert liefert
 * den leeren String, nicht `undefined`. Ein blankes `z.enum(...).optional()`
 * weist den leeren String deshalb ab — und zwar genau dann, wenn jemand der
 * Anleitung in `.env.example` folgt und die Zeile bewusst leer lässt.
 */
function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value.length === 0 ? undefined : value))
    .pipe(z.enum(values).optional());
}

const commaSeparated = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL muss eine gültige postgres:// URL sein'),
  TEST_DATABASE_URL: optionalNonEmpty,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(15_000),
});

export const supabaseEnvSchema = z.object({
  SUPABASE_URL: optionalNonEmpty,
  SUPABASE_ANON_KEY: optionalNonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,
  SUPABASE_JWT_SECRET: optionalNonEmpty,
});

export const transitEnvSchema = z.object({
  /**
   * Rückfall für alle Dienste von opentransportdata.swiss.
   *
   * Das Portal vergibt KEINEN Schlüssel für alles: pro Dienst wird eine eigene
   * Anwendung registriert (eigene App-ID, eigenes Token). Wer die Tokens
   * getrennt hat, setzt die dienstspezifischen Variablen unten; dieser Wert
   * greift nur, wo keine gesetzt ist.
   */
  OPENTRANSPORTDATA_API_KEY: optionalNonEmpty,
  /** CKAN-Portal — Download des GTFS-Static-Datensatzes (Fahrplan). */
  OPENTRANSPORTDATA_CKAN_API_KEY: optionalNonEmpty,
  /** GTFS-RT — Trip Updates (Verspätungen, Ausfälle). */
  OPENTRANSPORTDATA_GTFS_RT_API_KEY: optionalNonEmpty,
  /** GTFS-SA — Service Alerts (offizielle Störungsmeldungen). */
  OPENTRANSPORTDATA_GTFS_SA_API_KEY: optionalNonEmpty,
  /**
   * Authentifizierungsverfahren gegenüber opentransportdata.swiss.
   *
   * Leer lassen: die Verfahren werden bei 401/403 automatisch durchprobiert
   * (`bearer` → `raw` → `header`). Wer das richtige kennt, setzt es hier und
   * spart die Fallback-Anfragen.
   */
  OPENTRANSPORTDATA_AUTH_SCHEME: optionalEnum(['bearer', 'raw', 'header']),
  GTFS_STATIC_URL: z
    .string()
    .default('https://opentransportdata.swiss/dataset/timetable-2025-gtfs2020/permalink'),
  GTFS_RT_TRIP_UPDATES_URL: z.string().default('https://api.opentransportdata.swiss/gtfsrt2020'),
  GTFS_RT_SERVICE_ALERTS_URL: z.string().default('https://api.opentransportdata.swiss/gtfsrt2020'),
  GTFS_RT_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(30),
  SERVICE_ALERTS_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(86_400).default(120),
  OJP_API_KEY: optionalNonEmpty,
  OJP_ENDPOINT_URL: z.string().default('https://api.opentransportdata.swiss/ojp20'),
  OJP_REQUESTOR_REF: z.string().default('swissov-live'),
});

export const cacheEnvSchema = z.object({
  REDIS_URL: optionalNonEmpty,
});

/**
 * Web Push (RFC 8030 / VAPID).
 *
 * Der ÖFFENTLICHE Schlüssel wird über `GET /v1/app-config` an den Browser
 * ausgeliefert — das ist vorgesehen und unbedenklich. Der PRIVATE Schlüssel
 * darf ausschliesslich im Worker-Prozess existieren und niemals in einer
 * `NEXT_PUBLIC_*`-Variable, in einem Bundle oder in einem Log auftauchen.
 *
 * Schlüsselpaar erzeugen:  pnpm --filter @swissov/worker run push:keys
 */
const webPushEnvSchema = z.object({
  WEB_PUSH_VAPID_PUBLIC_KEY: optionalNonEmpty,
  WEB_PUSH_VAPID_PRIVATE_KEY: optionalNonEmpty,
  /** `mailto:`- oder `https:`-Adresse; Push-Dienste verlangen einen Kontakt. */
  WEB_PUSH_SUBJECT: optionalNonEmpty,
});

export const apiEnvSchema = baseEnvSchema
  .merge(webPushEnvSchema)
  .merge(databaseEnvSchema)
  .merge(supabaseEnvSchema)
  .merge(transitEnvSchema)
  .merge(cacheEnvSchema)
  .extend({
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    API_HOST: z.string().default('0.0.0.0'),
    /**
     * Erlaubte Browser-Origins.
     *
     * Seit die App eine PWA ist, ist der Browser ein CORS-Client — die native
     * App war es nie. Bleibt die Liste leer, fehlt in der Antwort der Header
     * `access-control-allow-origin`, und der Browser verwirft JEDE API-Antwort.
     * Der Fehler ist von aussen nicht zu sehen: die API antwortet mit 200, die
     * App bleibt trotzdem leer.
     *
     * Ausserhalb der Produktion sind deshalb die lokalen Ports voreingestellt
     * (Web 3002, Admin 3000, E2E 3102). In Produktion bleibt die Liste leer und
     * `superRefine` unten erzwingt eine bewusste Angabe.
     */
    API_CORS_ORIGINS: commaSeparated,
    API_INTERNAL_SECRET: z.string().min(16, 'API_INTERNAL_SECRET muss mindestens 16 Zeichen haben'),
    API_PUBLIC_URL: z.string().default('http://localhost:3001'),
    RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(240),
    RATE_LIMIT_REPORTS_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(20),
    RATE_LIMIT_VOTES_PER_HOUR: z.coerce.number().int().min(1).max(50_000).default(120),
    SENTRY_DSN: optionalNonEmpty,
  })
  .transform((env) => {
    // Lokale Voreinstellung — niemals in Produktion.
    if (env.NODE_ENV !== 'production' && env.API_CORS_ORIGINS.length === 0) {
      return {
        ...env,
        API_CORS_ORIGINS: [
          'http://localhost:3002',
          'http://127.0.0.1:3002',
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          'http://localhost:3102',
          'http://127.0.0.1:3102',
        ],
      };
    }
    return env;
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.API_INTERNAL_SECRET.includes('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_INTERNAL_SECRET'],
          message: 'Platzhalter-Secret in Produktion nicht erlaubt.',
        });
      }
      if (!env.SUPABASE_JWT_SECRET && !env.SUPABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_JWT_SECRET'],
          message:
            'In Produktion wird SUPABASE_JWT_SECRET oder SUPABASE_URL (JWKS) für die Token-Prüfung benötigt.',
        });
      }
      if (env.API_CORS_ORIGINS.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_CORS_ORIGINS'],
          message: 'In Produktion muss mindestens ein erlaubter CORS-Origin gesetzt sein.',
        });
      }
    }
  });
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = baseEnvSchema
  .merge(webPushEnvSchema)
  .merge(databaseEnvSchema)
  .merge(supabaseEnvSchema)
  .merge(transitEnvSchema)
  .merge(cacheEnvSchema)
  .extend({
    WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
    PUSH_ENABLED: booleanish.default(true),
    /**
     * Veraltet: nur für Altbestände der nativen App. Der Web-Push-Versand
     * verwendet ausschliesslich die VAPID-Schlüssel.
     */
    EXPO_ACCESS_TOKEN: optionalNonEmpty,
    /** Wie oft die Push-Warteschlange abgearbeitet wird. */
    PUSH_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(600).default(20),
    /** Wie oft abgelaufene Meldungen aufgeräumt werden. */
    EXPIRY_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
    /** Wie oft der GTFS-Static-Import geprüft wird (Cron-Ausdruck). */
    GTFS_IMPORT_CRON: z.string().default('0 3 * * *'),
    /** Automatischen GTFS-Import beim Start ausführen, falls keine aktive Version existiert. */
    GTFS_IMPORT_ON_BOOT: booleanish.default(false),
    SENTRY_DSN: optionalNonEmpty,
  });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export interface EnvLoadResult<T> {
  env: T;
  /** Nicht gesetzte optionale Integrationen — wird beim Start geloggt (§55). */
  missingIntegrations: string[];
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Parst und validiert die Umgebung. Bricht mit einer verständlichen Meldung ab,
 * statt später mit `undefined` weiterzulaufen (§44, §55).
 */
export function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Ungültige Umgebungskonfiguration:\n${formatZodError(result.error)}\n\n` +
        'Siehe .env.example für die vollständige Liste der Variablen.',
    );
  }
  return result.data;
}

/**
 * Die Zugangsdaten von opentransportdata.swiss, nach Dienst getrennt.
 *
 * Das Portal vergibt Tokens pro registrierter Anwendung, nicht pro Konto — der
 * Schlüssel für GTFS-RT öffnet den CKAN-Download nicht und umgekehrt. Wer die
 * Dienste verwechselt, bekommt ein HTTP 401/403, das wie ein abgelaufener
 * Schlüssel aussieht, aber keiner ist.
 */
export interface TransitApiKeys {
  /** CKAN-Portal — Download des GTFS-Static-Datensatzes. */
  ckan: string | undefined;
  /** GTFS-RT — Trip Updates (Verspätungen, Ausfälle). */
  gtfsRt: string | undefined;
  /** GTFS-SA — Service Alerts (offizielle Störungsmeldungen). */
  gtfsSa: string | undefined;
  /** OJP 2.0 — Verbindungssuche (optional). */
  ojp: string | undefined;
}

/** Die Umgebungsvariable, aus der ein Dienst seinen Schlüssel bezieht. */
export const TRANSIT_KEY_VARIABLES: Record<keyof TransitApiKeys, string> = {
  ckan: 'OPENTRANSPORTDATA_CKAN_API_KEY',
  gtfsRt: 'OPENTRANSPORTDATA_GTFS_RT_API_KEY',
  gtfsSa: 'OPENTRANSPORTDATA_GTFS_SA_API_KEY',
  ojp: 'OJP_API_KEY',
};

/**
 * Löst die dienstspezifischen Schlüssel auf, mit Rückfall auf den generischen.
 *
 * Der Rückfall existiert für zwei Fälle: bestehende Installationen, die vor
 * der Aufteilung nur `OPENTRANSPORTDATA_API_KEY` gesetzt haben, und Portale,
 * bei denen ein Token tatsächlich mehrere Dienste abdeckt. Er darf nie dazu
 * führen, dass ein gesetzter dienstspezifischer Schlüssel übergangen wird.
 */
export function resolveTransitApiKeys(env: {
  OPENTRANSPORTDATA_API_KEY?: string | undefined;
  OPENTRANSPORTDATA_CKAN_API_KEY?: string | undefined;
  OPENTRANSPORTDATA_GTFS_RT_API_KEY?: string | undefined;
  OPENTRANSPORTDATA_GTFS_SA_API_KEY?: string | undefined;
  OJP_API_KEY?: string | undefined;
}): TransitApiKeys {
  const fallback = env.OPENTRANSPORTDATA_API_KEY;
  return {
    ckan: env.OPENTRANSPORTDATA_CKAN_API_KEY ?? fallback,
    gtfsRt: env.OPENTRANSPORTDATA_GTFS_RT_API_KEY ?? fallback,
    gtfsSa: env.OPENTRANSPORTDATA_GTFS_SA_API_KEY ?? fallback,
    // OJP ist ein eigener Dienst mit eigenem Endpunkt. Ein generischer
    // Schlüssel wird hier NICHT eingesetzt: OJP ist optional, und ein
    // stillschweigend falscher Schlüssel würde die Verbindungssuche als
    // „konfiguriert, aber kaputt" erscheinen lassen statt als „nicht aktiv".
    ojp: env.OJP_API_KEY,
  };
}

/** Ermittelt, welche optionalen externen Integrationen mangels Credentials inaktiv sind. */
export function detectMissingIntegrations(env: {
  SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
  SUPABASE_JWT_SECRET?: string | undefined;
  OPENTRANSPORTDATA_API_KEY?: string | undefined;
  OPENTRANSPORTDATA_CKAN_API_KEY?: string | undefined;
  OPENTRANSPORTDATA_GTFS_RT_API_KEY?: string | undefined;
  OPENTRANSPORTDATA_GTFS_SA_API_KEY?: string | undefined;
  OJP_API_KEY?: string | undefined;
  REDIS_URL?: string | undefined;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string | undefined;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string | undefined;
}): string[] {
  const missing: string[] = [];
  if (!env.SUPABASE_URL) missing.push('SUPABASE_URL (Realtime-Broadcast & Admin-Auth deaktiviert)');
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    missing.push('SUPABASE_SERVICE_ROLE_KEY (Account-Löschung via Auth-Admin-API deaktiviert)');
  if (!env.SUPABASE_JWT_SECRET && !env.SUPABASE_URL)
    missing.push('SUPABASE_JWT_SECRET (Token-Verifikation nicht möglich → nur Gastzugriff)');
  // Jeder Dienst hat sein eigenes Token; fehlt eines, fällt genau ein Baustein
  // aus — nicht die ganze Anbindung. Deshalb wird jeder einzeln gemeldet.
  const keys = resolveTransitApiKeys(env);
  if (!keys.ckan)
    missing.push(`${TRANSIT_KEY_VARIABLES.ckan} (kein Fahrplan-Download — GTFS-Static)`);
  if (!keys.gtfsRt)
    missing.push(`${TRANSIT_KEY_VARIABLES.gtfsRt} (keine Verspätungen und Ausfälle — GTFS-RT)`);
  if (!keys.gtfsSa)
    missing.push(`${TRANSIT_KEY_VARIABLES.gtfsSa} (keine offiziellen Störungen — GTFS-SA)`);
  if (!keys.ojp) missing.push(`${TRANSIT_KEY_VARIABLES.ojp} (Verbindungssuche via OJP deaktiviert)`);
  if (!env.REDIS_URL) missing.push('REDIS_URL (In-Memory-Cache statt Redis — nicht clusterfähig)');
  if (!env.WEB_PUSH_VAPID_PUBLIC_KEY || !env.WEB_PUSH_VAPID_PRIVATE_KEY)
    missing.push('WEB_PUSH_VAPID_PUBLIC_KEY/PRIVATE_KEY (Push-Benachrichtigungen deaktiviert)');
  return missing;
}
