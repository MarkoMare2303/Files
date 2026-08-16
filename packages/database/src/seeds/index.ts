import { CONFIG_KEYS, DEFAULT_RUNTIME_CONFIG } from '@swissov/shared';
import { FeatureFlagKey } from '@swissov/types';
import type { Database } from '../client.js';
import { REPORT_CATEGORY_SEEDS } from './categories.js';

/**
 * Seeds (§57).
 *
 * Erlaubt sind ausschliesslich Stammdaten: Meldungskategorien, Feature-Flags
 * und Laufzeitkonfiguration. Es werden KEINE Beispiel-Meldungen, keine
 * Fake-Nutzer und keine Testfahrten erzeugt — der Produktivbetrieb darf keine
 * erfundenen Inhalte anzeigen (§56).
 *
 * Alle Seeds sind idempotent und überschreiben keine administrativen
 * Änderungen: vorhandene Zeilen bleiben unangetastet.
 */

export interface SeedResult {
  categoriesInserted: number;
  categoriesSkipped: number;
  featureFlagsInserted: number;
  configKeysInserted: number;
}

const FEATURE_FLAG_SEEDS: Array<{ key: string; enabled: boolean; description: string }> = [
  {
    key: FeatureFlagKey.AUTO_TRIP_DETECTION,
    enabled: true,
    description: 'Automatische Fahrtenerkennung über GPS (§10).',
  },
  {
    key: FeatureFlagKey.COMMUNITY_REPORTS,
    enabled: true,
    description: 'Erstellen und Anzeigen von Community-Meldungen.',
  },
  {
    key: FeatureFlagKey.PUSH_NOTIFICATIONS,
    enabled: true,
    description: 'Push-Benachrichtigungen für gefolgte Fahrten und Störungen.',
  },
  {
    key: FeatureFlagKey.OJP_ROUTING,
    enabled: false,
    description:
      'Verbindungssuche über Open Journey Planner. Benötigt OJP_API_KEY — bleibt ohne Key wirkungslos.',
  },
  {
    key: FeatureFlagKey.STATION_REPORTS,
    enabled: true,
    description: 'Meldungen mit Bezug auf Bahnhöfe und Haltestellen.',
  },
  {
    key: FeatureFlagKey.GUEST_MODE,
    enabled: true,
    description: 'Lesezugriff ohne Konto (§22). Meldungen erfordern weiterhin ein Konto.',
  },
];

export async function seed(
  db: Database,
  options: { log?: (message: string) => void } = {},
): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);
  const result: SeedResult = {
    categoriesInserted: 0,
    categoriesSkipped: 0,
    featureFlagsInserted: 0,
    configKeysInserted: 0,
  };

  await db.transaction(async (tx) => {
    for (const category of REPORT_CATEGORY_SEEDS) {
      const inserted = await tx.query(
        `INSERT INTO public.report_categories (
           key, label, description, icon, color, "group",
           default_scope, allowed_scopes, ttl_seconds, ttl_until_trip_end,
           requires_trip, requires_moderation, severity, sort_order, active
         )
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6::public.category_group,
                 $7::public.report_scope, $8::public.report_scope[], $9, $10,
                 $11, $12, $13::public.category_severity, $14, true)
         ON CONFLICT (key) DO NOTHING
         RETURNING id`,
        [
          category.key,
          JSON.stringify(category.label),
          category.description ? JSON.stringify(category.description) : null,
          category.icon,
          category.color,
          category.group,
          category.defaultScope,
          `{${category.allowedScopes.join(',')}}`,
          category.ttlSeconds,
          category.ttlUntilTripEnd ?? false,
          category.requiresTrip ?? false,
          category.requiresModeration ?? false,
          category.severity,
          category.sortOrder,
        ],
      );
      if (inserted.rowCount > 0) result.categoriesInserted += 1;
      else result.categoriesSkipped += 1;
    }

    for (const flag of FEATURE_FLAG_SEEDS) {
      const inserted = await tx.query(
        `INSERT INTO public.feature_flags (key, enabled, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [flag.key, flag.enabled, flag.description],
      );
      if (inserted.rowCount > 0) result.featureFlagsInserted += 1;
    }

    const configEntries: Array<[string, unknown, string]> = [
      [
        CONFIG_KEYS.DETECTION,
        DEFAULT_RUNTIME_CONFIG.detection,
        'Schwellen und Gewichte der Fahrtenerkennung (§10/§11).',
      ],
      [
        CONFIG_KEYS.RATE_LIMITS,
        DEFAULT_RUNTIME_CONFIG.rateLimits,
        'Rate Limits und Cooldowns des Meldesystems (§21).',
      ],
      [
        CONFIG_KEYS.MODERATION,
        DEFAULT_RUNTIME_CONFIG.moderation,
        'Automatische Moderationsregeln (§32).',
      ],
      [CONFIG_KEYS.TRUST, DEFAULT_RUNTIME_CONFIG.trust, 'Gewichte des Trust Scores (§19).'],
    ];

    for (const [key, value, description] of configEntries) {
      const inserted = await tx.query(
        `INSERT INTO public.app_config (key, value, description)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [key, JSON.stringify(value), description],
      );
      if (inserted.rowCount > 0) result.configKeysInserted += 1;
    }
  });

  log(
    `Seeds: ${result.categoriesInserted} Kategorien neu, ${result.categoriesSkipped} vorhanden, ` +
      `${result.featureFlagsInserted} Feature-Flags, ${result.configKeysInserted} Konfigurationsschlüssel.`,
  );
  return result;
}

export { REPORT_CATEGORY_SEEDS } from './categories.js';
export type { CategorySeed } from './categories.js';
