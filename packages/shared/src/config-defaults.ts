import type { RuntimeConfig } from '@swissov/types';

/**
 * Ausgangswerte der Laufzeitkonfiguration.
 *
 * Diese Werte werden beim ersten Start in `app_config` geschrieben und sind
 * danach ausschliesslich über das Admin-Portal änderbar (§32). Der Code liest
 * sie nie direkt aus dieser Konstante, sondern immer aus der Datenbank — die
 * Konstante dient als Seed und als Fallback, falls ein Schlüssel fehlt.
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  detection: {
    autoThreshold: 0.9,
    confirmThreshold: 0.7,
    defaultRadiusMeters: 1200,
    maxCandidates: 8,
    weights: {
      shapeDistance: 0.3,
      timeCompatibility: 0.25,
      directionCompatibility: 0.15,
      speedCompatibility: 0.1,
      stopSequence: 0.1,
      realtimeCompatibility: 0.1,
    },
  },
  rateLimits: {
    reportsPerHour: 20,
    reportsPerDay: 60,
    votesPerHour: 120,
    flagsPerDay: 30,
    reportCooldownSeconds: 20,
    duplicateWindowSeconds: 900,
  },
  moderation: {
    autoQueueFlagThreshold: 3,
    autoExpireDownvoteRatio: 0.7,
    autoExpireMinVotes: 4,
    preModerationReputationBelow: -20,
  },
  trust: {
    baseScore: 40,
    upvoteWeight: 30,
    downvoteWeight: 35,
    tripSessionBonus: 12,
    gpsPlausibilityBonus: 8,
    reputationWeight: 15,
    ageDecayHalfLifeMinutes: 45,
  },
};

/** Schlüssel, unter denen die Konfigurationsblöcke in `app_config` liegen. */
export const CONFIG_KEYS = {
  DETECTION: 'detection',
  RATE_LIMITS: 'rateLimits',
  MODERATION: 'moderation',
  TRUST: 'trust',
} as const;
