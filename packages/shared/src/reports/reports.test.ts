import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNTIME_CONFIG } from '../config-defaults.js';
import { MIN_TTL_SECONDS, computeExpiresAt, isExpired, shouldAutoExpire } from './expiry.js';
import { computeTrustScore, trustTier } from './trust.js';

const CREATED_AT = new Date('2025-03-11T16:38:00Z');

describe('computeExpiresAt', () => {
  it('nutzt die TTL der Kategorie', () => {
    const expiresAt = computeExpiresAt({
      category: { ttlSeconds: 1800, ttlUntilTripEnd: false },
      createdAt: CREATED_AT,
    });
    expect(expiresAt.toISOString()).toBe('2025-03-11T17:08:00.000Z');
  });

  it('verlängert bis Fahrtende, wenn die Kategorie das vorsieht', () => {
    const tripEndsAt = new Date('2025-03-11T18:30:00Z');
    const expiresAt = computeExpiresAt({
      category: { ttlSeconds: 1800, ttlUntilTripEnd: true },
      createdAt: CREATED_AT,
      tripEndsAt,
    });
    // Fahrtende + 5 Minuten Nachlauf
    expect(expiresAt.toISOString()).toBe('2025-03-11T18:35:00.000Z');
  });

  it('nutzt die TTL, wenn das Fahrtende früher liegt als die TTL', () => {
    const tripEndsAt = new Date('2025-03-11T16:40:00Z');
    const expiresAt = computeExpiresAt({
      category: { ttlSeconds: 3600, ttlUntilTripEnd: true },
      createdAt: CREATED_AT,
      tripEndsAt,
    });
    expect(expiresAt.toISOString()).toBe('2025-03-11T17:38:00.000Z');
  });

  it('fällt ohne Fahrtende auf die TTL zurück', () => {
    const expiresAt = computeExpiresAt({
      category: { ttlSeconds: 900, ttlUntilTripEnd: true },
      createdAt: CREATED_AT,
      tripEndsAt: null,
    });
    expect(expiresAt.toISOString()).toBe('2025-03-11T16:53:00.000Z');
  });

  it('erzwingt eine Mindestlebensdauer', () => {
    const expiresAt = computeExpiresAt({
      category: { ttlSeconds: 5, ttlUntilTripEnd: false },
      createdAt: CREATED_AT,
    });
    expect(expiresAt.getTime() - CREATED_AT.getTime()).toBe(MIN_TTL_SECONDS * 1000);
  });
});

describe('isExpired', () => {
  it('erkennt abgelaufene Meldungen', () => {
    const expiresAt = new Date('2025-03-11T17:00:00Z');
    expect(isExpired({ expiresAt }, new Date('2025-03-11T17:00:01Z'))).toBe(true);
    expect(isExpired({ expiresAt }, new Date('2025-03-11T16:59:59Z'))).toBe(false);
  });
});

describe('shouldAutoExpire', () => {
  const config = DEFAULT_RUNTIME_CONFIG.moderation;

  it('beendet Meldungen mit klarer Mehrheit an Gegenstimmen', () => {
    expect(shouldAutoExpire({ upvotes: 1, downvotes: 6 }, config)).toBe(true);
  });

  it('greift nicht bei zu wenigen Stimmen', () => {
    expect(shouldAutoExpire({ upvotes: 0, downvotes: 2 }, config)).toBe(false);
  });

  it('greift nicht bei ausgeglichenem Bild', () => {
    expect(shouldAutoExpire({ upvotes: 4, downvotes: 4 }, config)).toBe(false);
  });
});

describe('computeTrustScore', () => {
  const trust = DEFAULT_RUNTIME_CONFIG.trust;
  const base = {
    upvotes: 0,
    downvotes: 0,
    createdAt: CREATED_AT,
    authorReputation: 0,
    hadTripSession: true,
    tripSessionConfidence: 0.95,
    gpsPlausibility: 1,
    flagsCount: 0,
    recentReportsByAuthor: 1,
  };

  it('liegt für eine frische, plausible Meldung im mittleren Band', () => {
    const score = computeTrustScore(base, trust, CREATED_AT);
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThan(70);
    expect(trustTier(score)).toBe('LIKELY');
  });

  it('steigt mit Bestätigungen in das obere Band', () => {
    const score = computeTrustScore({ ...base, upvotes: 8 }, trust, CREATED_AT);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(trustTier(score)).toBe('CONFIRMED');
  });

  it('fällt mit Gegenstimmen deutlich', () => {
    const withUp = computeTrustScore({ ...base, upvotes: 5 }, trust, CREATED_AT);
    const withDown = computeTrustScore({ ...base, upvotes: 5, downvotes: 8 }, trust, CREATED_AT);
    expect(withDown).toBeLessThan(withUp - 20);
  });

  it('bestraft fehlende Trip-Zuordnung', () => {
    const withSession = computeTrustScore(base, trust, CREATED_AT);
    const withoutSession = computeTrustScore(
      { ...base, hadTripSession: false, tripSessionConfidence: null },
      trust,
      CREATED_AT,
    );
    expect(withoutSession).toBeLessThan(withSession);
  });

  it('bestraft unplausible GPS-Daten', () => {
    const plausible = computeTrustScore(base, trust, CREATED_AT);
    const implausible = computeTrustScore({ ...base, gpsPlausibility: 0 }, trust, CREATED_AT);
    expect(implausible).toBeLessThan(plausible);
  });

  it('lässt Bestätigungen mit der Zeit verblassen', () => {
    const fresh = computeTrustScore({ ...base, upvotes: 8 }, trust, CREATED_AT);
    const old = computeTrustScore(
      { ...base, upvotes: 8 },
      trust,
      new Date(CREATED_AT.getTime() + 3 * 60 * 60 * 1000),
    );
    expect(old).toBeLessThan(fresh);
  });

  it('berücksichtigt Missbrauchsmeldungen stark negativ', () => {
    const clean = computeTrustScore({ ...base, upvotes: 5 }, trust, CREATED_AT);
    const flagged = computeTrustScore({ ...base, upvotes: 5, flagsCount: 3 }, trust, CREATED_AT);
    expect(flagged).toBeLessThan(clean - 30);
  });

  it('bleibt immer im Bereich 0..100', () => {
    const worst = computeTrustScore(
      {
        ...base,
        downvotes: 50,
        authorReputation: -100,
        hadTripSession: false,
        tripSessionConfidence: null,
        gpsPlausibility: 0,
        flagsCount: 10,
        recentReportsByAuthor: 50,
      },
      trust,
      CREATED_AT,
    );
    const best = computeTrustScore(
      { ...base, upvotes: 200, authorReputation: 100 },
      trust,
      CREATED_AT,
    );
    expect(worst).toBe(0);
    expect(best).toBeLessThanOrEqual(100);
    expect(best).toBeGreaterThan(70);
  });
});

describe('trustTier', () => {
  it('bildet die Bänder aus §19 ab', () => {
    expect(trustTier(0)).toBe('LOW');
    expect(trustTier(30)).toBe('LOW');
    expect(trustTier(31)).toBe('LIKELY');
    expect(trustTier(69)).toBe('LIKELY');
    expect(trustTier(70)).toBe('CONFIRMED');
    expect(trustTier(100)).toBe('CONFIRMED');
  });
});
