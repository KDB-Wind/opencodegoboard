import type {
  DailyModelStat,
  DailyStat,
  ModelTokenStat,
  OpenCodeAccount,
  Overview,
  QuotaAccount,
  QuotaSnapshot,
  QuotaIntelligence,
  QuotaWeightRule,
  ServiceConfig,
  UsageRecord,
  UsageResponse,
  UsageDataHealth,
  ModelQuotaTier,
} from './types';
import { invoke } from '@tauri-apps/api/core';

const GET_CACHE_TTL_MS = 3000;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightGets = new Map<string, Promise<unknown>>();

async function fetchGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return invoke<T>('api_request', { request: { method: 'GET', path, body: null } });
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
  const result = await invoke<T>('api_request', { request: { method, path, body: body ?? null } });
  responseCache.clear();
  return result;
}

async function del<T>(path: string): Promise<T> {
  const result = await invoke<T>('api_request', { request: { method: 'DELETE', path, body: null } });
  responseCache.clear();
  return result;
}

export const api = {
  // Consolidated dashboard (overview + quota + recent usage in one call)
  getDashboard: (period = '30d', signal?: AbortSignal) => get<{
    overview: Overview;
    quota: QuotaAccount[];
    recent_usage: { records: UsageRecord[]; total: number };
    model_tokens: ModelTokenStat[];
    equivalent_cost_usd: number;
    data_health: UsageDataHealth[];
    quota_intelligence: QuotaIntelligence[];
    period: string;
    timezone: string;
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
  getQuotaWeightRules: () => get<{ rules: QuotaWeightRule[] }>('/quota/weights'),
  createQuotaWeightRule: (rule: {
    account_id?: string | null; plan?: string | null; model_pattern: string;
    weight: number; effective_from: string;
  }) => post<QuotaWeightRule>('/quota/weights', rule),
  calibrateQuotaWeights: (accountId?: string) => post<{ created: QuotaWeightRule[] }>(
    `/quota/weights/calibrate${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`,
  ),
  listModelQuotas: () => get<{ models: ModelQuotaTier[] }>('/model-quotas'),
  upsertModelQuota: (data: {
    display_name: string;
    monthly_quota_usd: number;
    input_price_usd?: number | null;
    output_price_usd?: number | null;
    cache_read_price_usd?: number | null;
    cache_write_price_usd?: number | null;
  }) => post<ModelQuotaTier>('/model-quotas', data),
  deleteModelQuota: (modelKey: string) =>
    del<{ ok: boolean }>(`/model-quotas/${encodeURIComponent(modelKey)}`),
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
  getDailyStats: (days = 30, accountId?: string, signal?: AbortSignal, from?: string, to?: string) => {
    let path = `/analytics/opencode/daily?days=${days}`;
    if (accountId) path += `&account_id=${encodeURIComponent(accountId)}`;
    if (from) path += `&from=${encodeURIComponent(from)}`;
    if (to) path += `&to=${encodeURIComponent(to)}`;
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
  getModelTokenStats: (days = 30, accountId?: string, period?: string, signal?: AbortSignal, from?: string, to?: string) => {
    let path = `/analytics/opencode/model-tokens?days=${days}`;
    if (period) path += `&period=${encodeURIComponent(period)}`;
    if (accountId) path += `&account_id=${encodeURIComponent(accountId)}`;
    if (from) path += `&from=${encodeURIComponent(from)}`;
    if (to) path += `&to=${encodeURIComponent(to)}`;
    return get<{ days: number; stats: ModelTokenStat[]; equivalent_cost_usd: number }>(path, signal);
  },

  // Config
  updateConfig: (data: Record<string, unknown>) =>
    put<ServiceConfig>('/config', data),

  // Health
  health: () => get<{ status: string }>('/health'),
  dataHealth: () => get<{ accounts: UsageDataHealth[] }>('/health/data'),
};
