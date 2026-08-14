export interface QuotaSnapshotLike {
  account_id: string;
  account_name: string;
  window_label: string;
  captured_at: string;
  used: number;
  remaining: number;
  reset_at: string;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function analyzeQuotaWindows(
  input: Array<Record<string, unknown>>,
  now = new Date(),
): Array<Record<string, unknown>> {
  const groups = new Map<string, QuotaSnapshotLike[]>();
  for (const raw of input) {
    const snapshot: QuotaSnapshotLike = {
      account_id: String(raw.account_id), account_name: String(raw.account_name),
      window_label: String(raw.window_label), captured_at: String(raw.captured_at),
      used: Number(raw.used), remaining: Number(raw.remaining), reset_at: String(raw.reset_at),
    };
    const key = `${snapshot.account_id}\u0000${snapshot.window_label}`;
    groups.set(key, [...(groups.get(key) ?? []), snapshot]);
  }

  return [...groups.values()].map((snapshots) => {
    snapshots.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    const latest = snapshots[snapshots.length - 1];
    const rates: number[] = [];
    for (let index = 1; index < snapshots.length; index += 1) {
      const previous = snapshots[index - 1];
      const current = snapshots[index];
      const elapsedHours = (Date.parse(current.captured_at) - Date.parse(previous.captured_at)) / 3600000;
      const delta = current.used - previous.used;
      if (current.reset_at !== previous.reset_at || elapsedHours < 1 / 12 || delta <= 0 || delta > 50) continue;
      rates.push(delta / elapsedHours);
    }
    const rate = median(rates);
    const resetHours = Math.max(0, (Date.parse(latest.reset_at) - now.getTime()) / 3600000);
    const hoursToExhaust = rate > 0 ? latest.remaining / rate : null;
    const confidence = rates.length >= 6 ? 'high' : rates.length >= 3 ? 'medium' : rates.length ? 'low' : 'insufficient';
    const split = Math.floor(rates.length / 2);
    const baselineRate = split >= 2 ? median(rates.slice(0, split)) : null;
    const recentRate = split >= 2 ? median(rates.slice(split)) : null;
    const acceleration = baselineRate && recentRate ? recentRate / baselineRate : null;
    const reserve = 10;
    const safeBudgetPerDay = resetHours > 0 ? Math.max(0, latest.remaining - reserve) / (resetHours / 24) : 0;
    const canLast = hoursToExhaust == null ? null : hoursToExhaust >= resetHours;
    const alertLevel = canLast === false
      ? 'critical'
      : latest.remaining <= reserve || (acceleration != null && acceleration >= 1.5)
        ? 'warning'
        : canLast == null ? 'unknown' : 'safe';
    return {
      account_id: latest.account_id, account_name: latest.account_name,
      window_label: latest.window_label, captured_at: latest.captured_at,
      reset_at: latest.reset_at, remaining: latest.remaining,
      consumption_per_hour: rates.length ? round(rate, 4) : null,
      hours_to_exhaust: hoursToExhaust == null ? null : round(hoursToExhaust, 1),
      hours_to_reset: round(resetHours, 1),
      can_last_until_reset: canLast,
      sample_count: rates.length, confidence,
      reserve_percent: reserve,
      safe_budget_per_day: round(safeBudgetPerDay, 2),
      projected_remaining_at_reset: rate > 0 ? round(latest.remaining - rate * resetHours, 2) : null,
      acceleration_ratio: acceleration == null ? null : round(acceleration, 2),
      alert_level: alertLevel,
    };
  }).sort((a, b) => Number(a.hours_to_exhaust ?? Infinity) - Number(b.hours_to_exhaust ?? Infinity));
}

export function reconcileQuotaWindows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const usedDelta = Number(row.used) - Number(row.previous_used);
    const remainingDelta = Number(row.remaining) - Number(row.previous_remaining);
    const elapsedHours = (Date.parse(String(row.captured_at)) - Date.parse(String(row.previous_captured_at))) / 3600000;
    const resetChanged = String(row.reset_at) !== String(row.previous_reset_at);
    const totalChanged = Number(row.total) !== Number(row.previous_total);
    const localRequests = Number(row.local_request_count || 0);
    const gapThreshold = String(row.window_label).includes('5h') ? 12 : 48;
    let eventType = 'matched';
    if (totalChanged) eventType = 'rule_change';
    else if (resetChanged || usedDelta < -20) eventType = 'reset';
    else if (remainingDelta > 5 && usedDelta <= 0) eventType = 'top_up';
    else if (elapsedHours > gapThreshold) eventType = 'snapshot_gap';
    else if (usedDelta > 0.5 && localRequests === 0) eventType = 'missing_local_usage';
    return {
      account_id: String(row.account_id), account_name: String(row.account_name),
      window_label: String(row.window_label), from: String(row.previous_captured_at),
      to: String(row.captured_at), event_type: eventType,
      official_used_delta: Math.round(usedDelta * 100) / 100,
      official_remaining_delta: Math.round(remainingDelta * 100) / 100,
      local_request_count: localRequests, local_tokens: Number(row.local_tokens || 0),
      elapsed_hours: Math.round(elapsedHours * 10) / 10,
      excluded_from_calibration: eventType !== 'matched',
    };
  });
}

function patternMatches(pattern: string, model: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(model);
}

export function buildUsageRecommendations(
  windows: Array<Record<string, unknown>>,
  rules: Array<Record<string, unknown>>,
  models: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const accounts = new Map<string, { name: string; worstRemaining: number; critical: boolean; samples: number }>();
  for (const window of windows) {
    const id = String(window.account_id);
    const current = accounts.get(id) ?? {
      name: String(window.account_name), worstRemaining: 100, critical: false, samples: 0,
    };
    current.worstRemaining = Math.min(current.worstRemaining, Number(window.remaining));
    current.critical ||= window.can_last_until_reset === false;
    current.samples += Number(window.sample_count || 0);
    accounts.set(id, current);
  }
  const rankedAccounts = [...accounts.entries()].sort((a, b) =>
    Number(a[1].critical) - Number(b[1].critical) || b[1].worstRemaining - a[1].worstRemaining);
  const recommendedAccount = rankedAccounts[0];

  let modelChoice: { model: string; weight: number } | null = null;
  if (recommendedAccount) {
    for (const modelRow of models) {
      const model = String(modelRow.model);
      const candidates = rules.filter((rule) =>
        (!rule.account_id || rule.account_id === recommendedAccount[0]) &&
        String(rule.effective_from) <= new Date().toISOString() &&
        patternMatches(String(rule.model_pattern), model));
      candidates.sort((a, b) =>
        Number(Boolean(b.account_id)) - Number(Boolean(a.account_id)) ||
        String(b.effective_from).localeCompare(String(a.effective_from)));
      const weight = Number(candidates[0]?.weight || 1);
      if (!modelChoice || weight < modelChoice.weight) modelChoice = { model, weight };
    }
  }
  return {
    account: recommendedAccount ? {
      account_id: recommendedAccount[0], name: recommendedAccount[1].name,
      bottleneck_remaining: recommendedAccount[1].worstRemaining,
      reason_code: recommendedAccount[1].critical ? 'least_risk_among_critical' : 'best_safe_headroom',
      confidence: recommendedAccount[1].samples >= 6 ? 'high' : recommendedAccount[1].samples >= 2 ? 'medium' : 'low',
    } : null,
    model: modelChoice ? {
      model: modelChoice.model, weight: modelChoice.weight,
      reason_code: 'lowest_effective_quota_weight',
    } : null,
    generated_at: new Date().toISOString(),
  };
}
