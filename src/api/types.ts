export interface OpenCodeAccount {
  id: string;
  name: string;
  workspace_id: string;
  resolved_workspace_id: string | null;
  auth_cookie_masked: string;
  configured: boolean;
  show_rolling: boolean;
  show_weekly: boolean;
  show_monthly: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuotaWindow {
  label: string;
  used: number;
  remaining: number;
  total: number;
  reset_at: string;
  reset_in_sec: number;
  blocked?: boolean;
  blocked_by?: string;
  effective_remaining?: number;
}

export interface QuotaAccount {
  account_id: string;
  name: string;
  success: boolean;
  workspace_id: string;
  windows: QuotaWindow[];
}

export interface Overview {
  opencode: {
    avg_effective_remaining: number;
    account_count: number;
    success_count: number;
    blocked_count: number;
    accounts: Array<{
      account_id: string;
      name: string;
      success: boolean;
      effective_remaining: number;
      blocked: boolean;
      windows: QuotaWindow[];
    }>;
  };
}

export interface DailyStat {
  date: string;
  total_cost_usd: number;
  request_count: number;
  total_input_tokens: number;
  uncached_input_tokens: number;
  cache_hit_tokens: number;
  cache_write_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number;
}

export interface DailyModelStat {
  date: string;
  model: string;
  total_cost_usd: number;
  request_count: number;
  total_input_tokens: number;
  uncached_input_tokens: number;
  cache_hit_tokens: number;
  cache_write_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number;
}

export interface ModelTokenStat {
  model: string;
  request_count: number;
  total_input_tokens: number;
  uncached_input_tokens: number;
  cache_hit_tokens: number;
  cache_write_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number;
  total_cost_usd: number;
}

export interface UsageRecord {
  usg_id: string;
  account_id: string;
  account_name?: string;
  created_at: string;
  model: string;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  uncached_input_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd: number;
  key_id: string | null;
  session_id: string | null;
  plan: string | null;
}

export interface UsageResponse {
  records: UsageRecord[];
  total: number;
  offset: number;
  limit: number;
  accounts?: Array<{ id: string; name: string }>;
  key_ids?: string[];
  sync?: {
    last_sync_at: string | null;
    last_sync_status: string | null;
    last_sync_error: string | null;
    last_success_at: string | null;
    last_failed_page: number | null;
    last_parse_error_count: number;
    total_records: number;
    oldest_record_at: string | null;
    newest_record_at: string | null;
  };
}

export interface UsageSession {
  account_id: string;
  account_name: string;
  session_id: string | null;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  first_at: string;
  last_at: string;
}

export interface UsageDataHealth {
  account_id: string;
  account_name: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_success_at: string | null;
  last_failed_page: number | null;
  last_parse_error_count: number;
  last_inserted_count: number;
  deepest_page_fetched: number;
  total_records: number;
  oldest_record_at: string | null;
  newest_record_at: string | null;
  healthy: boolean;
}

export interface ServiceConfig {
  refresh: {
    opencode_go: { auto_refresh: boolean; interval_sec: number };
  };
  usage_sync: {
    auto_sync: boolean;
    interval_sec: number;
    backfill_pages_per_request: number;
    max_pages_per_incremental: number;
  };
  accounts_imported: boolean;
  opencode_accounts: OpenCodeAccount[];
}
