import { describe, expect, it } from 'vitest';
import { selectQuotaAlert } from './quotaNotifications';
import type { QuotaIntelligence } from '../api/types';

const make = (alert_level: QuotaIntelligence['alert_level'], remaining: number): QuotaIntelligence => ({
  account_id: alert_level, account_name: alert_level, window_label: 'Weekly',
  captured_at: 'now', reset_at: 'later', remaining, consumption_per_hour: 1,
  hours_to_exhaust: 1, hours_to_reset: 2, can_last_until_reset: false,
  sample_count: 2, confidence: 'low', reserve_percent: 10, safe_budget_per_day: 1,
  projected_remaining_at_reset: -1, acceleration_ratio: null, alert_level,
});

describe('quota notification selection', () => {
  it('respects thresholds and prioritizes the most severe tightest window', () => {
    const windows = [make('warning', 8), make('critical', 5), make('critical', 2)];
    expect(selectQuotaAlert(windows, 'critical')?.remaining).toBe(2);
    expect(selectQuotaAlert([make('warning', 8)], 'critical')).toBeNull();
    expect(selectQuotaAlert([make('warning', 8)], 'warning')?.alert_level).toBe('warning');
  });
});
