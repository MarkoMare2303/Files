import type { Database } from '@swissov/database';
import { CONFIG_KEYS, DEFAULT_RUNTIME_CONFIG } from '@swissov/shared';
import { runtimeConfigSchema, type RuntimeConfig } from '@swissov/types';
import { cacheKeys, type Cache } from '../lib/cache.js';

/**
 * Laufzeitkonfiguration (§32).
 *
 * Die Werte stehen in `app_config` und sind ausschliesslich über das
 * Admin-Portal änderbar. Sie werden kurz gecacht, damit jede Meldung nicht
 * vier zusätzliche Queries auslöst — und bei Änderungen sofort invalidiert.
 */
const CACHE_TTL_SECONDS = 60;

export class ConfigService {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
  ) {}

  private async section<K extends keyof RuntimeConfig>(key: K): Promise<RuntimeConfig[K]> {
    const cacheKey = cacheKeys.runtimeConfig(key);
    const hit = await this.cache.get<RuntimeConfig[K]>(cacheKey);
    if (hit) return hit;

    const row = await this.db.queryOne<{ value: unknown }>(
      'SELECT value FROM public.app_config WHERE key = $1',
      [key],
    );

    const schema = runtimeConfigSchema.shape[key];
    const parsed = schema.safeParse(row?.value);
    // Ungültige oder fehlende Konfiguration darf den Betrieb nicht anhalten:
    // in diesem Fall greifen die Ausgangswerte.
    const value = (parsed.success ? parsed.data : DEFAULT_RUNTIME_CONFIG[key]) as RuntimeConfig[K];

    await this.cache.set(cacheKey, value, CACHE_TTL_SECONDS);
    return value;
  }

  detection(): Promise<RuntimeConfig['detection']> {
    return this.section(CONFIG_KEYS.DETECTION);
  }

  rateLimits(): Promise<RuntimeConfig['rateLimits']> {
    return this.section(CONFIG_KEYS.RATE_LIMITS);
  }

  moderation(): Promise<RuntimeConfig['moderation']> {
    return this.section(CONFIG_KEYS.MODERATION);
  }

  trust(): Promise<RuntimeConfig['trust']> {
    return this.section(CONFIG_KEYS.TRUST);
  }

  async all(): Promise<RuntimeConfig> {
    const [detection, rateLimits, moderation, trust] = await Promise.all([
      this.detection(),
      this.rateLimits(),
      this.moderation(),
      this.trust(),
    ]);
    return { detection, rateLimits, moderation, trust };
  }

  /**
   * Schreibt einen Konfigurationsblock. Die Validierung passiert serverseitig
   * gegen das Zod-Schema — Client-Angaben werden nie ungeprüft übernommen (§42).
   */
  async update<K extends keyof RuntimeConfig>(
    key: K,
    value: unknown,
    actorId: string,
  ): Promise<{ previous: RuntimeConfig[K]; next: RuntimeConfig[K] }> {
    const schema = runtimeConfigSchema.shape[key];
    const parsed = schema.parse(value) as RuntimeConfig[K];
    const previous = await this.section(key);

    await this.db.query(
      `INSERT INTO public.app_config (key, value, updated_by)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(parsed), actorId],
    );
    await this.cache.del(cacheKeys.runtimeConfig(key));
    return { previous, next: parsed };
  }
}
