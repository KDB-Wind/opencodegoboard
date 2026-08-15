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

export interface QuotaSnapshot {
  id: number;
  account_id: string;
  account_name: string;
  window_label: string;
  captured_at: string;
  used: number;
  remaining: number;
  total: number;
  reset_at: string;
  reset_in_sec: number;
}

export interface QuotaIntelligence {
  account_id: string;
  account_name: string;
  window_label: string;
  captured_at: string;
  reset_at: string;
  remaining: number;
  consumption_per_hour: number | null;
  hours_to_exhaust: number | null;
  hours_to_reset: number;
  can_last_until_reset: boolean | null;
  sample_count: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  reserve_percent: number;
  safe_budget_per_day: number;
  projected_remaining_at_reset: number | null;
  acceleration_ratio: number | null;
  alert_level: 'safe' | 'warning' | 'critical' | 'unknown';
}

export interface QuotaReconciliationEvent {
  account_id: string;
  account_name: string;
  window_label: string;
  from: string;
  to: string;
  event_type: 'matched' | 'reset' | 'top_up' | 'snapshot_gap' | 'missing_local_usage' | 'rule_change';
  official_used_delta: number;
  official_remaining_delta: number;
  local_request_count: number;
  local_tokens: number;
  elapsed_hours: number;
  excluded_from_calibration: boolean;
}

export interface QuotaWeightRule {
  id: string;
  account_id: string | null;
  account_name?: string | null;
  plan: string | null;
  model_pattern: string;
  weight: number;
  effective_from: string;
  source: 'default' | 'manual' | 'auto';
  sample_count: number;
  confidence: number;
}

export interface QuotaUnitStats {
  period: string;
  total_quota_units: number;
  request_count: number;
  models: Array<{ model: string; quota_units: number; processed_tokens: number; request_count: number }>;
}

export interface UsageRecommendation {
  account: {
    account_id: string; name: string; bottleneck_remaining: number;
    reason_code: 'best_safe_headroom' | 'least_risk_among_critical';
    confidence: 'high' | 'medium' | 'low';
  } | null;
  model: { model: string; weight: number; reason_code: 'lowest_effective_quota_weight' } | null;
  generated_at: string;
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
      bottleneck_window: string | null;
      bottleneck_remaining: number | null;
    }>;
    bottleneck: { account_id: string; name: string; window: string; remaining: number } | null;
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
  project_path?: string | null;
  session_title?: string | null;
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
  project_name: string | null;
  project_path: string | null;
  session_title: string | null;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  first_at: string;
  last_at: string;
}

export interface ProjectUsageStat {
  project_name: string;
  project_path: string | null;
  request_count: number;
  session_count: number;
  total_cost_usd: number;
  total_tokens: number;
  cache_hit_rate: number;
  models: Array<{ model: string; request_count: number; total_tokens: number; total_cost_usd: number }>;
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
  timezone: string;
  refresh: {
    opencode_go: { auto_refresh: boolean; interval_sec: number };
  };
  usage_sync: {
    auto_sync: boolean;
    interval_sec: number;
    backfill_pages_per_request: number;
    max_pages_per_incremental: number;
  };
  feature_flags: {
    token_stats: boolean;
    usage_records: boolean;
    quota_intelligence: boolean;
    data_tools: boolean;
    advanced_sync: boolean;
  };
  feature_legacy_prompt_pending: boolean;
  accounts_imported: boolean;
  opencode_accounts: OpenCodeAccount[];
}
