import type { Database } from '@swissov/database';
import { createHash } from 'node:crypto';
import { cacheKeys, type Cache } from '../lib/cache.js';

/**
 * Feature-Flags (§62).
 *
 * Unterstützt gestuftes Ausrollen: `rollout_percentage` entscheidet anhand
 * eines stabilen Hashes aus Flag-Schlüssel und Nutzer-ID. Derselbe Nutzer
 * erhält damit über alle Anfragen hinweg dieselbe Antwort.
 */
export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  description: string | null;
  rollout_percentage: number;
  updated_at: Date;
}

const CACHE_TTL_SECONDS = 30;

export class FeatureFlagService {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
  ) {}

  async all(): Promise<FeatureFlagRow[]> {
    const hit = await this.cache.get<FeatureFlagRow[]>(cacheKeys.featureFlags());
    if (hit) return hit;
    const { rows } = await this.db.query<FeatureFlagRow>(
      'SELECT key, enabled, description, rollout_percentage, updated_at FROM public.feature_flags ORDER BY key',
    );
    await this.cache.set(cacheKeys.featureFlags(), rows, CACHE_TTL_SECONDS);
    return rows;
  }

  async isEnabled(key: string, userId?: string): Promise<boolean> {
    const flags = await this.all();
    const flag = flags.find((f) => f.key === key);
    // Unbekannte Flags gelten als deaktiviert — sicherer Standard.
    if (!flag || !flag.enabled) return false;
    if (flag.rollout_percentage >= 100) return true;
    if (flag.rollout_percentage <= 0) return false;
    if (!userId) return false;
    return bucketOf(key, userId) < flag.rollout_percentage;
  }

  async set(
    key: string,
    values: { enabled?: boolean; rolloutPercentage?: number; description?: string | null },
    actorId: string,
  ): Promise<FeatureFlagRow> {
    const row = await this.db.queryOne<FeatureFlagRow>(
      `UPDATE public.feature_flags SET
         enabled = COALESCE($2, enabled),
         rollout_percentage = COALESCE($3, rollout_percentage),
         description = COALESCE($4, description),
         updated_by = $5
       WHERE key = $1
       RETURNING key, enabled, description, rollout_percentage, updated_at`,
      [
        key,
        values.enabled ?? null,
        values.rolloutPercentage ?? null,
        values.description ?? null,
        actorId,
      ],
    );
    if (!row) throw new Error(`Unbekanntes Feature-Flag: ${key}`);
    await this.cache.del(cacheKeys.featureFlags());
    return row;
  }
}

/** Stabiler Bucket 0..99 aus Flag und Nutzer. */
export function bucketOf(key: string, userId: string): number {
  const digest = createHash('sha256').update(`${key}:${userId}`).digest();
  return ((digest[0]! << 8) | digest[1]!) % 100;
}
