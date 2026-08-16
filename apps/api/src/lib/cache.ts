import Redis from 'ioredis';

/**
 * Cache-Abstraktion (§38).
 *
 * Zwei Treiber:
 *   • Redis  — für Produktion, geteilt über alle Instanzen
 *   • Memory — für lokale Entwicklung und Tests, ohne externe Abhängigkeit
 *
 * Der Aufrufer kennt den Unterschied nicht. Fällt Redis aus, degradiert der
 * Cache auf „kein Treffer" statt die Anfrage scheitern zu lassen.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Löscht alle Schlüssel mit dem angegebenen Präfix (Invalidierung). */
  delByPrefix(prefix: string): Promise<void>;
  healthcheck(): Promise<{ ok: boolean; driver: string; message?: string }>;
  close(): Promise<void>;
}

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

export class MemoryCache implements Cache {
  private readonly store = new Map<string, MemoryEntry>();
  private readonly maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    // LRU-Näherung: bei Treffer ans Ende verschieben.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async healthcheck(): Promise<{ ok: boolean; driver: string }> {
    return { ok: true, driver: 'memory' };
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

export class RedisCache implements Cache {
  private readonly redis: Redis;
  private available = true;

  constructor(url: string, private readonly keyPrefix = 'swissov:') {
    this.redis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.redis.on('error', (error) => {
      if (this.available) {
        console.error('[cache] Redis nicht erreichbar, Cache wird übersprungen:', error.message);
      }
      this.available = false;
    });
    this.redis.on('ready', () => {
      this.available = true;
    });
  }

  private full(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.available) return null;
    try {
      const raw = await this.redis.get(this.full(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.available) return;
    try {
      await this.redis.set(this.full(key), JSON.stringify(value), 'EX', Math.max(1, ttlSeconds));
    } catch {
      // Cache-Fehler dürfen die Anfrage nie zum Scheitern bringen.
    }
  }

  async del(key: string): Promise<void> {
    if (!this.available) return;
    try {
      await this.redis.del(this.full(key));
    } catch {
      /* ignoriert */
    }
  }

  async delByPrefix(prefix: string): Promise<void> {
    if (!this.available) return;
    try {
      // SCAN statt KEYS: blockiert den Server nicht.
      const stream = this.redis.scanStream({ match: `${this.full(prefix)}*`, count: 200 });
      for await (const keys of stream) {
        const batch = keys as string[];
        if (batch.length > 0) await this.redis.del(...batch);
      }
    } catch {
      /* ignoriert */
    }
  }

  async healthcheck(): Promise<{ ok: boolean; driver: string; message?: string }> {
    try {
      await this.redis.ping();
      return { ok: true, driver: 'redis' };
    } catch (error) {
      return {
        ok: false,
        driver: 'redis',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

export function createCache(redisUrl: string | undefined): Cache {
  return redisUrl ? new RedisCache(redisUrl) : new MemoryCache();
}

/** Liest aus dem Cache oder berechnet den Wert und legt ihn ab. */
export async function cached<T>(
  cache: Cache,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;
  const value = await produce();
  await cache.set(key, value, ttlSeconds);
  return value;
}

/** Cache-Schlüssel an einer Stelle definieren — verhindert Kollisionen. */
export const cacheKeys = {
  categories: () => 'categories:v1',
  runtimeConfig: (key: string) => `config:${key}`,
  featureFlags: () => 'flags:v1',
  stopsNearby: (lat: number, lon: number, radius: number) =>
    // Auf ~11 m gerundet: benachbarte Anfragen treffen denselben Eintrag.
    `stops:near:${lat.toFixed(4)}:${lon.toFixed(4)}:${radius}`,
  stop: (stopId: string) => `stop:${stopId}`,
  departures: (stopId: string, bucket: number) => `dep:${stopId}:${bucket}`,
  trip: (tripId: string, serviceDate: string) => `trip:${tripId}:${serviceDate}`,
  search: (query: string) => `search:${query.toLowerCase().slice(0, 60)}`,
  alerts: () => 'alerts:active:v1',
  activeFeed: () => 'feed:active',
} as const;
