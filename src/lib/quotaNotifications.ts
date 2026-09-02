import type { QuotaIntelligence } from '../api/types';
import { formatPercent } from './format';

export type NotificationThreshold = 'warning' | 'critical';

export interface QuotaNotificationSettings {
  enabled: boolean;
  threshold: NotificationThreshold;
}

const SETTINGS_KEY = 'opencodegoboard.quotaNotifications';
const LAST_KEY = 'opencodegoboard.lastQuotaNotification';

export function loadQuotaNotificationSettings(): QuotaNotificationSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { enabled: parsed.enabled === true, threshold: parsed.threshold === 'warning' ? 'warning' : 'critical' };
  } catch {
    return { enabled: false, threshold: 'critical' };
  }
}

export function saveQuotaNotificationSettings(settings: QuotaNotificationSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function selectQuotaAlert(
  windows: QuotaIntelligence[],
  threshold: NotificationThreshold,
): QuotaIntelligence | null {
  const rank = { unknown: 0, safe: 0, warning: 1, critical: 2 };
  const minimum = threshold === 'warning' ? 1 : 2;
  return [...windows]
    .filter((window) => rank[window.alert_level] >= minimum)
    .sort((a, b) => rank[b.alert_level] - rank[a.alert_level] || a.remaining - b.remaining)[0] ?? null;
}

export async function notifyQuotaAlert(windows: QuotaIntelligence[], title: string): Promise<void> {
  const settings = loadQuotaNotificationSettings();
  if (!settings.enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const alert = selectQuotaAlert(windows, settings.threshold);
  if (!alert) return;
  const key = `${alert.account_id}:${alert.window_label}:${alert.captured_at}:${alert.alert_level}`;
  if (localStorage.getItem(LAST_KEY) === key) return;
  new Notification(title, {
    body: `${alert.account_name} · ${alert.window_label} · ${formatPercent(alert.remaining)}`,
    tag: `quota:${alert.account_id}:${alert.window_label}`,
  });
  localStorage.setItem(LAST_KEY, key);
}
