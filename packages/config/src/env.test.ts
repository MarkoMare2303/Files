import { describe, expect, it } from 'vitest';
import {
  apiEnvSchema,
  detectMissingIntegrations,
  parseEnv,
  workerEnvSchema,
} from './env.js';

/**
 * Tests der Umgebungsvalidierung.
 *
 * Wichtig ist vor allem, dass Fehlkonfigurationen früh und verständlich
 * scheitern — nicht erst zur Laufzeit mit `undefined` (§44/§55).
 */
const BASE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  API_INTERNAL_SECRET: 'a-secret-with-at-least-16-chars',
};

describe('apiEnvSchema', () => {
  it('akzeptiert eine minimale Entwicklungskonfiguration', () => {
    const env = parseEnv(apiEnvSchema, BASE as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.API_CORS_ORIGINS).toEqual([]);
  });

  it('lehnt eine ungültige Datenbank-URL ab', () => {
    expect(() => parseEnv(apiEnvSchema, { ...BASE, DATABASE_URL: 'nicht-url' } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL/,
    );
  });

  it('verlangt ein ausreichend langes Secret', () => {
    expect(() =>
      parseEnv(apiEnvSchema, { ...BASE, API_INTERNAL_SECRET: 'kurz' } as NodeJS.ProcessEnv),
    ).toThrow(/API_INTERNAL_SECRET/);
  });

  it('zerlegt die CORS-Liste', () => {
    const env = parseEnv(apiEnvSchema, {
      ...BASE,
      API_CORS_ORIGINS: 'https://a.ch, https://b.ch ,',
    } as NodeJS.ProcessEnv);
    expect(env.API_CORS_ORIGINS).toEqual(['https://a.ch', 'https://b.ch']);
  });

  it('behandelt leere optionale Werte als nicht gesetzt', () => {
    const env = parseEnv(apiEnvSchema, { ...BASE, REDIS_URL: '   ' } as NodeJS.ProcessEnv);
    expect(env.REDIS_URL).toBeUndefined();
  });

  describe('in Produktion', () => {
    const production = { ...BASE, NODE_ENV: 'production' };

    it('verbietet das Platzhalter-Secret', () => {
      expect(() =>
        parseEnv(apiEnvSchema, {
          ...production,
          API_INTERNAL_SECRET: 'change-me-in-production-min-32-characters',
          API_CORS_ORIGINS: 'https://admin.example.ch',
          SUPABASE_JWT_SECRET: 'secret',
        } as NodeJS.ProcessEnv),
      ).toThrow(/Platzhalter-Secret/);
    });

    it('verlangt eine Möglichkeit zur Token-Prüfung', () => {
      expect(() =>
        parseEnv(apiEnvSchema, {
          ...production,
          API_CORS_ORIGINS: 'https://admin.example.ch',
        } as NodeJS.ProcessEnv),
      ).toThrow(/SUPABASE_JWT_SECRET/);
    });

    it('verlangt mindestens einen CORS-Origin', () => {
      expect(() =>
        parseEnv(apiEnvSchema, {
          ...production,
          SUPABASE_JWT_SECRET: 'secret',
        } as NodeJS.ProcessEnv),
      ).toThrow(/CORS/);
    });

    it('akzeptiert eine vollständige Produktionskonfiguration', () => {
      const env = parseEnv(apiEnvSchema, {
        ...production,
        SUPABASE_JWT_SECRET: 'ein-echtes-jwt-secret',
        API_CORS_ORIGINS: 'https://admin.example.ch',
      } as NodeJS.ProcessEnv);
      expect(env.NODE_ENV).toBe('production');
    });
  });
});

describe('workerEnvSchema', () => {
  it('setzt sinnvolle Standardintervalle', () => {
    const env = parseEnv(workerEnvSchema, BASE as NodeJS.ProcessEnv);
    expect(env.GTFS_RT_POLL_INTERVAL_SECONDS).toBe(30);
    expect(env.SERVICE_ALERTS_POLL_INTERVAL_SECONDS).toBe(120);
    expect(env.PUSH_ENABLED).toBe(true);
  });

  it('interpretiert boolesche Werte aus Strings', () => {
    const env = parseEnv(workerEnvSchema, {
      ...BASE,
      PUSH_ENABLED: 'false',
      GTFS_IMPORT_ON_BOOT: 'true',
    } as NodeJS.ProcessEnv);
    expect(env.PUSH_ENABLED).toBe(false);
    expect(env.GTFS_IMPORT_ON_BOOT).toBe(true);
  });

  it('lehnt zu kurze Polling-Intervalle ab (Provider-Rate-Limits)', () => {
    expect(() =>
      parseEnv(workerEnvSchema, {
        ...BASE,
        GTFS_RT_POLL_INTERVAL_SECONDS: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});

describe('detectMissingIntegrations', () => {
  it('meldet alle fehlenden optionalen Integrationen', () => {
    const missing = detectMissingIntegrations({});
    expect(missing.some((entry) => entry.includes('OPENTRANSPORTDATA_API_KEY'))).toBe(true);
    expect(missing.some((entry) => entry.includes('OJP_API_KEY'))).toBe(true);
    expect(missing.some((entry) => entry.includes('REDIS_URL'))).toBe(true);
  });

  it('meldet nichts, wenn alles konfiguriert ist', () => {
    const missing = detectMissingIntegrations({
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
      SUPABASE_JWT_SECRET: 'secret',
      OPENTRANSPORTDATA_API_KEY: 'key',
      OJP_API_KEY: 'key',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(missing).toEqual([]);
  });
});
