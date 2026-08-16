import { describe, expect, it } from 'vitest';
import {
  REPUTATION_MAX,
  REPUTATION_MIN,
  ReputationEventType,
  applyReputationEvent,
  reputationTier,
  requiresPreModeration,
} from './reputation.js';

describe('applyReputationEvent', () => {
  it('erhöht die Reputation bei bestätigten Meldungen', () => {
    expect(applyReputationEvent(0, ReputationEventType.REPORT_CONFIRMED)).toBe(3);
  });

  it('senkt sie bei moderativer Entfernung deutlich stärker', () => {
    const gain = applyReputationEvent(0, ReputationEventType.REPORT_CONFIRMED);
    const loss = applyReputationEvent(0, ReputationEventType.REPORT_REMOVED_BY_MODERATION);
    expect(Math.abs(loss)).toBeGreaterThan(gain * 3);
  });

  it('bleibt in den Grenzen', () => {
    expect(applyReputationEvent(REPUTATION_MAX, ReputationEventType.REPORT_CONFIRMED)).toBe(
      REPUTATION_MAX,
    );
    expect(applyReputationEvent(REPUTATION_MIN, ReputationEventType.SPAM_DETECTED)).toBe(
      REPUTATION_MIN,
    );
  });
});

describe('reputationTier', () => {
  it('stuft neue Konten als NEW ein', () => {
    expect(reputationTier({ score: 80, accountAgeDays: 1, confirmedReports: 50 })).toBe('NEW');
  });

  it('erfordert Punkte, Kontoalter und bestätigte Meldungen für TRUSTED', () => {
    expect(reputationTier({ score: 45, accountAgeDays: 40, confirmedReports: 12 })).toBe('TRUSTED');
    expect(reputationTier({ score: 45, accountAgeDays: 40, confirmedReports: 5 })).toBe(
      'ESTABLISHED',
    );
  });

  it('stuft ein Konto mit negativer Reputation als NEW ein', () => {
    expect(reputationTier({ score: -30, accountAgeDays: 400, confirmedReports: 100 })).toBe('NEW');
  });
});

describe('requiresPreModeration', () => {
  it('greift unterhalb der konfigurierten Schwelle', () => {
    expect(requiresPreModeration(-25, -20)).toBe(true);
    expect(requiresPreModeration(-10, -20)).toBe(false);
  });
});
