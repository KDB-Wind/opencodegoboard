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
    return {
      account_id: latest.account_id, account_name: latest.account_name,
      window_label: latest.window_label, captured_at: latest.captured_at,
      reset_at: latest.reset_at, remaining: latest.remaining,
      consumption_per_hour: rates.length ? round(rate, 4) : null,
      hours_to_exhaust: hoursToExhaust == null ? null : round(hoursToExhaust, 1),
      hours_to_reset: round(resetHours, 1),
      can_last_until_reset: hoursToExhaust == null ? null : hoursToExhaust >= resetHours,
      sample_count: rates.length, confidence,
    };
  }).sort((a, b) => Number(a.hours_to_exhaust ?? Infinity) - Number(b.hours_to_exhaust ?? Infinity));
}
