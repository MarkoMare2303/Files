import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { describe, expect, it } from 'vitest';
import {
  apiEnvSchema,
  detectMissingIntegrations,
  parseEnv,
  transitEnvSchema,
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
    // Ohne Angabe sind ausserhalb der Produktion die lokalen Ports erlaubt —
    // sonst blockiert der Browser jede Anfrage der PWA, und zwar unsichtbar.
    expect(env.API_CORS_ORIGINS).toContain('http://localhost:3002');
    expect(env.API_CORS_ORIGINS).toContain('http://localhost:3000');
  });

  it('übernimmt gesetzte CORS-Origins unverändert', () => {
    const env = parseEnv(apiEnvSchema, {
      ...BASE,
      API_CORS_ORIGINS: 'https://app.example.ch',
    } as NodeJS.ProcessEnv);
    expect(env.API_CORS_ORIGINS).toEqual(['https://app.example.ch']);
  });

  it('setzt in Produktion KEINE lokalen Origins ein', () => {
    // In Produktion muss die Liste bewusst gesetzt werden; die Voreinstellung
    // darf dort nicht greifen.
    expect(() =>
      parseEnv(apiEnvSchema, {
        ...BASE,
        NODE_ENV: 'production',
        API_INTERNAL_SECRET: 'ein-echtes-langes-produktionssecret',
        SUPABASE_JWT_SECRET: 'produktions-jwt-secret',
      } as NodeJS.ProcessEnv),
    ).toThrow(/API_CORS_ORIGINS/);
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

describe('.env.example', () => {
  /**
   * Der dokumentierte Einstieg ist `cp .env.example .env`. Genau dieser Weg
   * muss funktionieren — und tat es nicht: `OPENTRANSPORTDATA_AUTH_SCHEME=`
   * ist dort bewusst leer („Leer lassen: …"), wurde von der Aufzählung aber
   * abgewiesen. Der Fehler trat erst beim ersten Einrichten mit echten
   * Zugangsdaten auf, weil vorher niemand die Beispieldatei wirklich geparst
   * hat. Dieser Test parst sie.
   */
  const example = parseDotenv(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env.example'), 'utf8'),
  ) as NodeJS.ProcessEnv;

  it('ist als Vorlage überhaupt einlesbar', () => {
    expect(Object.keys(example).length).toBeGreaterThan(20);
    // Die Zeile, die den Fehler ausgelöst hat: vorhanden, aber leer.
    expect(example.OPENTRANSPORTDATA_AUTH_SCHEME).toBe('');
  });

  it('wird unverändert von allen Schemata akzeptiert', () => {
    expect(() => parseEnv(apiEnvSchema, example)).not.toThrow();
    expect(() => parseEnv(workerEnvSchema, example)).not.toThrow();
    expect(() => parseEnv(transitEnvSchema, example)).not.toThrow();
  });

  it('führt leere optionale Werte auf „nicht gesetzt" zurück', () => {
    const env = parseEnv(apiEnvSchema, example);
    expect(env.OPENTRANSPORTDATA_AUTH_SCHEME).toBeUndefined();
    expect(env.OPENTRANSPORTDATA_API_KEY).toBeUndefined();
    expect(env.SUPABASE_URL).toBeUndefined();
    // Werte MIT Inhalt bleiben erhalten — die Vorlage ist keine Leerdatei.
    expect(env.GTFS_STATIC_URL).toContain('opentransportdata.swiss');
  });
});

describe('OPENTRANSPORTDATA_AUTH_SCHEME', () => {
  it('akzeptiert die drei Verfahren', () => {
    for (const scheme of ['bearer', 'raw', 'header'] as const) {
      const env = parseEnv(transitEnvSchema, {
        OPENTRANSPORTDATA_AUTH_SCHEME: scheme,
      } as NodeJS.ProcessEnv);
      expect(env.OPENTRANSPORTDATA_AUTH_SCHEME).toBe(scheme);
    }
  });

  it('behandelt leer und nur Leerzeichen als nicht gesetzt', () => {
    for (const value of ['', '   ']) {
      const env = parseEnv(transitEnvSchema, {
        OPENTRANSPORTDATA_AUTH_SCHEME: value,
      } as NodeJS.ProcessEnv);
      expect(env.OPENTRANSPORTDATA_AUTH_SCHEME).toBeUndefined();
    }
  });

  it('lehnt einen Tippfehler weiterhin ab', () => {
    // Die Nachsicht gegenüber Leerwerten darf keine Nachsicht gegenüber
    // falschen Werten werden — sonst wird still das falsche Verfahren genutzt.
    expect(() =>
      parseEnv(transitEnvSchema, {
        OPENTRANSPORTDATA_AUTH_SCHEME: 'Bearer',
      } as NodeJS.ProcessEnv),
    ).toThrow(/OPENTRANSPORTDATA_AUTH_SCHEME/);
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
      WEB_PUSH_VAPID_PUBLIC_KEY: 'public',
      WEB_PUSH_VAPID_PRIVATE_KEY: 'private',
    });
    expect(missing).toEqual([]);
  });

  it('meldet fehlende VAPID-Schlüssel — ohne sie gibt es keine Benachrichtigungen', () => {
    const missing = detectMissingIntegrations({ WEB_PUSH_VAPID_PUBLIC_KEY: 'public' });
    expect(missing.some((entry) => entry.includes('WEB_PUSH'))).toBe(true);
  });
});
