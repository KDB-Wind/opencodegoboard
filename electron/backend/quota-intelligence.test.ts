import { describe, expect, it } from 'vitest';
import { analyzeQuotaWindows } from './quota-intelligence';

const base = {
  account_id: 'a', account_name: 'Main', window_label: 'Weekly',
  remaining: 70, reset_at: '2026-08-20T00:00:00Z',
};

describe('quota endurance prediction', () => {
  it('predicts whether quota lasts to reset from continuous intervals', () => {
    const result = analyzeQuotaWindows([
      { ...base, captured_at: '2026-08-15T00:00:00Z', used: 10, remaining: 90 },
      { ...base, captured_at: '2026-08-15T01:00:00Z', used: 20, remaining: 80 },
      { ...base, captured_at: '2026-08-15T02:00:00Z', used: 30, remaining: 70 },
    ], new Date('2026-08-15T02:00:00Z'));
    expect(result[0]).toMatchObject({
      consumption_per_hour: 10, hours_to_exhaust: 7, hours_to_reset: 118,
      can_last_until_reset: false, sample_count: 2, confidence: 'low',
    });
  });

  it('excludes reset intervals and reports insufficient data', () => {
    const result = analyzeQuotaWindows([
      { ...base, captured_at: '2026-08-14T23:00:00Z', used: 90, remaining: 10, reset_at: '2026-08-15T00:00:00Z' },
      { ...base, captured_at: '2026-08-15T00:00:00Z', used: 1, remaining: 99 },
    ], new Date('2026-08-15T00:00:00Z'));
    expect(result[0]).toMatchObject({
      consumption_per_hour: null, hours_to_exhaust: null,
      can_last_until_reset: null, sample_count: 0, confidence: 'insufficient',
    });
  });

  it('flags accelerated consumption and calculates a reserve-aware daily budget', () => {
    const snapshots = [0, 1, 2, 4, 8].map((used, index) => ({
      ...base, used, remaining: 100 - used,
      captured_at: `2026-08-15T0${index}:00:00Z`, reset_at: '2026-08-19T04:00:00Z',
    }));
    const result = analyzeQuotaWindows(snapshots, new Date('2026-08-15T04:00:00Z'))[0];
    expect(result).toMatchObject({ acceleration_ratio: 3, safe_budget_per_day: 20.5, alert_level: 'critical' });
  });
});
