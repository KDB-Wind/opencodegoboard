import type {
  DailyModelStat,
  DailyStat,
  ModelTokenStat,
  OpenCodeAccount,
  Overview,
  QuotaAccount,
  QuotaSnapshot,
  QuotaIntelligence,
  QuotaReconciliationEvent,
  QuotaWeightRule,
  QuotaUnitStats,
  ServiceConfig,
  UsageRecord,
  UsageResponse,
  UsageDataHealth,
  UsageSession,
} from './types';

const backendPort = typeof window !== 'undefined' && window.electronAPI?.getBackendPort
  ? window.electronAPI.getBackendPort()
  : 8788;
const backendToken = typeof window !== 'undefined' && window.electronAPI?.getBackendToken
  ? window.electronAPI.getBackendToken()
  : '';
const BASE = (import.meta.env.VITE_API_BASE || `http://127.0.0.1:${backendPort}`) + '/api';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
    ...extra,
  };
}

const GET_CACHE_TTL_MS = 3000;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightGets = new Map<string, Promise<unknown>>();

async function fetchGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders(), signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
  }
  return res.json();
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) responseCache.delete(path);

  // Signal-bound calls must remain independently cancellable. Regular calls share one request.
  if (signal) return fetchGet<T>(path, signal);
  const existing = inFlightGets.get(path);
  if (existing) return existing as Promise<T>;
  const request = fetchGet<T>(path)
    .then((value) => {
      responseCache.set(path, { expiresAt: Date.now() + GET_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => inFlightGets.delete(path));
  inFlightGets.set(path, request);
  return request;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return req<T>('POST', path, body);
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  return req<T>('PUT', path, body);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
  }
  responseCache.clear();
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? ': ' + text : ''}`);
  }
  responseCache.clear();
  return res.json();
}

async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const api = {
  // Consolidated dashboard (overview + quota + recent usage in one call)
  getDashboard: (period = '30d', signal?: AbortSignal) => get<{
    overview: Overview;
    quota: QuotaAccount[];
    recent_usage: { records: UsageRecord[]; total: number };
    model_tokens: ModelTokenStat[];
    data_health: UsageDataHealth[];
    quota_intelligence: QuotaIntelligence[];
    quota_reconciliation: QuotaReconciliationEvent[];
    quota_units: QuotaUnitStats;
    period: string;
  }>(`/dashboard?period=${period}`, signal),
  // Config
  getConfig: () => get<ServiceConfig>('/config'),

  // Accounts
  listOpenCodeAccounts: (signal?: AbortSignal) => get<OpenCodeAccount[]>('/accounts/opencode', signal),
  createOpenCodeAccount: (data: {
    name: string;
    workspace_id?: string;
    auth_cookie: string;
  }) => post<OpenCodeAccount>('/accounts/opencode', data),
  updateOpenCodeAccount: (id: string, data: Record<string, unknown>) =>
    put<OpenCodeAccount>(`/accounts/opencode/${id}`, data),
  deleteOpenCodeAccount: (id: string) => del<{ ok: boolean }>(`/accounts/opencode/${id}`),
  testOpenCodeAccount: (id: string) =>
    post<{ success: boolean; workspace_id?: string; error?: string }>(
      `/accounts/opencode/${id}/test`,
    ),

  // Quota
  getQuota: () => get<QuotaAccount[]>('/quota'),
  getQuotaSnapshots: (accountId?: string, windowLabel?: string, limit = 500) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (accountId) query.set('account_id', accountId);
    if (windowLabel) query.set('window_label', windowLabel);
    return get<{ snapshots: QuotaSnapshot[] }>(`/quota/snapshots?${query}`);
  },
  getQuotaIntelligence: (accountId?: string) => get<{ windows: QuotaIntelligence[] }>(
    `/quota/intelligence${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`,
  ),
  getQuotaReconciliation: (accountId?: string) => get<{ events: QuotaReconciliationEvent[] }>(
    `/quota/reconciliation${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`,
  ),
  getQuotaWeightRules: () => get<{ rules: QuotaWeightRule[] }>('/quota/weights'),
  createQuotaWeightRule: (rule: {
    account_id?: string | null; plan?: string | null; model_pattern: string;
    weight: number; effective_from: string;
  }) => post<QuotaWeightRule>('/quota/weights', rule),
  calibrateQuotaWeights: (accountId?: string) => post<{ created: QuotaWeightRule[] }>(
    `/quota/weights/calibrate${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`,
  ),
  getQuotaUnits: (period = '30d', accountId?: string) => get<QuotaUnitStats>(
    `/quota/units?period=${encodeURIComponent(period)}${accountId ? `&account_id=${encodeURIComponent(accountId)}` : ''}`,
  ),
  getAccountQuota: (id: string) => get<QuotaAccount>(`/accounts/opencode/${id}/quota`),

  // Usage Records
  getAccountUsage: (id: string, offset = 0, limit = 100, keyId?: string) => {
    let path = `/accounts/opencode/${id}/usage?offset=${offset}&limit=${limit}`;
    if (keyId) path += `&key_id=${encodeURIComponent(keyId)}`;
    return get<UsageResponse>(path);
  },
  getAllUsage: (offset = 0, limit = 50, accountId?: string, signal?: AbortSignal) => {
    let path = `/usage/all?offset=${offset}&limit=${limit}`;
    if (accountId) path += `&account_id=${encodeURIComponent(accountId)}`;
    return get<UsageResponse>(path, signal);
  },
  getUsageSessions: (offset = 0, limit = 50, accountId?: string, signal?: AbortSignal) => {
    let path = `/usage/sessions?offset=${offset}&limit=${limit}`;
    if (accountId) path += `&account_id=${encodeURIComponent(accountId)}`;
    return get<{ sessions: UsageSession[]; total: number; offset: number; limit: number }>(path, signal);
  },
  getSessionUsage: (accountId: string, sessionId: string | null) => {
    let path = `/usage/session-records?account_id=${encodeURIComponent(accountId)}&limit=200`;
    path += sessionId == null
      ? '&unassigned=true'
      : `&session_id=${encodeURIComponent(sessionId)}`;
    return get<UsageResponse>(path);
  },
  syncUsage: (id: string) =>
    post<{ inserted: number; pages_fetched: number; sync_at: string }>(
      `/accounts/opencode/${id}/usage/sync`,
    ),
  backfillUsage: (id: string, target: { mode: 'days' | 'until' | 'all'; days?: number; until?: string }) => {
    const query = new URLSearchParams({ mode: target.mode });
    if (target.days) query.set('days', String(target.days));
    if (target.until) query.set('until', target.until);
    return (
    post<{ inserted: number; pages_fetched: number; sync_at: string }>(
      `/accounts/opencode/${id}/usage/backfill?${query}`,
    ));
  },
  syncProgress: (id: string) =>
    get<{ status: string; current: number; total: number; inserted: number; error?: string }>(
      `/accounts/opencode/${id}/usage/progress`,
    ),

  // Analytics
  getOverview: () => get<Overview>('/analytics/overview'),
  getDailyStats: (days = 30, accountId?: string, signal?: AbortSignal) => {
    let path = `/analytics/opencode/daily?days=${days}`;
    if (accountId) path += `&account_id=${encodeURIComponent(accountId)}`;
    return get<{ days: number; stats: DailyStat[] }>(path, signal);
  },
  getHourlyStats: (accountId?: string, signal?: AbortSignal) => {
    let path = '/analytics/opencode/hourly';
    if (accountId) path += `?account_id=${encodeURIComponent(accountId)}`;
    return get<{ hours: 24; stats: DailyStat[] }>(path, signal);
  },
  getDailyModelStats: (days = 30, accountId?: string, signal?: AbortSignal) => {
    let path = `/analytics/opencode/daily/models?days=${days}`;
    if (accountId) path += `&account_id=${encodeURIComponent(accountId)}`;
    return get<{ days: number; stats: DailyModelStat[] }>(path, signal);
  },
  getModelTokenStats: (days = 30, accountId?: string, period?: string, signal?: AbortSignal) => {
    let path = `/analytics/opencode/model-tokens?days=${days}`;
    if (period) path += `&period=${encodeURIComponent(period)}`;
    if (accountId) path += `&account_id=${encodeURIComponent(accountId)}`;
    return get<{ days: number; stats: ModelTokenStat[] }>(path, signal);
  },

  // Config
  updateConfig: (data: Record<string, unknown>) =>
    put<ServiceConfig>('/config', data),

  // Health
  health: () => get<{ status: string }>('/health'),
  dataHealth: () => get<{ accounts: UsageDataHealth[] }>('/health/data'),

  // Data portability
  exportUsageCsv: () => download('/data/export.csv', 'opencodegoboard-usage.csv'),
  backupDatabase: () => download('/data/backup', 'opencodegoboard-backup.db'),
  restoreDatabase: async (file: File) => {
    const res = await fetch(`${BASE}/data/restore`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/octet-stream' }), body: file,
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { detail?: string };
      throw new Error(payload.detail || `${res.status} ${res.statusText}`);
    }
    responseCache.clear();
    return res.json() as Promise<{ ok: boolean; schema_version: number }>;
  },
};
