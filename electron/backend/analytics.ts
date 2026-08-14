import * as db from './db';
import type { AccountConfig } from './config';
import { LABEL_MONTHLY, LABEL_ROLLING, LABEL_WEEKLY, fetchAllQuotas } from './quota';

function windowByLabel(
  windows: Record<string, unknown>[],
  label: string,
): Record<string, unknown> | null {
  for (const window of windows) {
    if (window.label === label) return window;
  }
  return null;
}

export function applyOpencodeCascade(
  windows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const monthly = windowByLabel(windows, LABEL_MONTHLY);
  const weekly = windowByLabel(windows, LABEL_WEEKLY);

  const monthlyFull = monthly != null && Number(monthly.used ?? 0) >= 100;
  const weeklyFull = weekly != null && Number(weekly.used ?? 0) >= 100;

  return windows.map((window) => {
    const item = { ...window };
    const label = String(item.label ?? '');
    let blocked = false;
    let blockedBy = '';
    if (label === LABEL_WEEKLY && monthlyFull) {
      blocked = true;
      blockedBy = LABEL_MONTHLY;
    } else if (label === LABEL_ROLLING && (monthlyFull || weeklyFull)) {
      blocked = true;
      blockedBy = monthlyFull ? LABEL_MONTHLY : LABEL_WEEKLY;
    }
    if (blocked) {
      item.blocked = true;
      item.blocked_by = blockedBy;
      item.effective_remaining = 0.0;
    } else {
      item.blocked = false;
      item.effective_remaining = Number(item.remaining ?? 0);
    }
    return item;
  });
}

export function opencodeEffectiveRemaining(windows: Record<string, unknown>[]): number {
  const cascaded = applyOpencodeCascade(windows);
  const monthly = windowByLabel(cascaded, LABEL_MONTHLY);
  if (monthly != null) return Number(monthly.effective_remaining ?? 0);
  const weekly = windowByLabel(cascaded, LABEL_WEEKLY);
  if (weekly != null) return Number(weekly.effective_remaining ?? 0);
  const rolling = windowByLabel(cascaded, LABEL_ROLLING);
  if (rolling != null) return Number(rolling.effective_remaining ?? 0);
  return 0.0;
}

export function aggregateOpencode(accounts: Record<string, unknown>[]): Record<string, unknown> {
  const perAccount: Record<string, unknown>[] = [];
  const effectiveValues: number[] = [];
  let blockedCount = 0;

  for (const account of accounts) {
    const windows = (account.windows as Record<string, unknown>[]) || [];
    const cascaded = applyOpencodeCascade(windows);
    const effective = opencodeEffectiveRemaining(windows);
    const isBlocked = effective <= 0 && Boolean(account.success);
    if (isBlocked) blockedCount += 1;
    if (account.success) effectiveValues.push(effective);
    perAccount.push({
      account_id: account.account_id,
      name: account.name,
      success: account.success ?? false,
      effective_remaining: Math.round(effective * 10) / 10,
      blocked: isBlocked,
      windows: cascaded,
    });
  }

  const avgEffective =
    effectiveValues.length > 0
      ? Math.round(
          (effectiveValues.reduce((a, b) => a + b, 0) / effectiveValues.length) * 10,
        ) / 10
      : 0.0;

  return {
    avg_effective_remaining: avgEffective,
    account_count: accounts.length,
    success_count: effectiveValues.length,
    blocked_count: blockedCount,
    accounts: perAccount,
  };
}

export async function buildOverview(
  sources: { opencodeQuotas?: Record<string, unknown>[] } = {},
): Promise<Record<string, unknown>> {
  const opencodeRows = db.listOpencodeAccounts(true);

  const opencodeAccountsCfg: AccountConfig[] = opencodeRows.map((row) => ({
    name: row.name,
    workspace_id: row.workspace_id,
    auth_cookie: row.auth_cookie,
    show_rolling: row.show_rolling,
    show_weekly: row.show_weekly,
    show_monthly: row.show_monthly,
  }));

  const opencodeQuotas = sources.opencodeQuotas ?? (opencodeAccountsCfg.length
    ? await fetchAllQuotas(opencodeAccountsCfg)
    : []);

  const opencodeIdByName = Object.fromEntries(opencodeRows.map((r) => [r.name, r.id]));
  for (const item of opencodeQuotas) {
    item.account_id = opencodeIdByName[String(item.name ?? '')];
  }
  return {
    opencode: aggregateOpencode(opencodeQuotas),
  };
}
