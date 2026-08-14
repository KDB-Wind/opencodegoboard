import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';
import { ModelIcon } from '../components/ModelIcon';
import { UsageTable } from '../components/UsageTable';
import { TokenBreakdownTooltip } from '../components/TokenBreakdownTooltip';
import { useToast } from '../components/Toast';
import { getStoredTimeRange, storeTimeRange, TimeRangeTabs, type TimeRange } from '../components/TimeRangeTabs';
import { notifyQuotaAlert } from '../lib/quotaNotifications';
import type { QuotaWindow } from '../api/types';

function fmt(v: number) {
  if (v >= 1_000_000_000_000) return (v / 1_000_000_000_000).toFixed(2) + 'T';
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
}

function fmtTime(sec: number) {
  if (sec <= 0) return '0';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const barColors: Record<string, string> = {
  '5h Rolling': 'bg-primary',
  Weekly: 'bg-secondary',
  Monthly: 'bg-accent',
};

const barLabelKeys: Record<string, string> = {
  '5h Rolling': 'dashboard.5h',
  Weekly: 'dashboard.7d',
  Monthly: 'dashboard.30d',
};

function QuotaBar({ windows }: { windows: QuotaWindow[] }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="space-y-3">
      {windows.map((w) => {
        const v = Math.min(Math.round(w.used), 100);
        const c = w.blocked ? 'bg-base-200'
          : v >= 100 ? 'bg-error'
          : v >= 80 ? 'bg-warning'
          : barColors[w.label] || 'bg-primary';
        return (
          <div key={w.label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${c}`} />
                <span className="text-xs text-base-content/60">{t(barLabelKeys[w.label] || w.label)}</span>
              </div>
              <span className="text-xs font-bold tabular-nums">{v}%</span>
            </div>
            <div className="h-2 bg-base-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${c}`} style={{ width: `${v}%` }} />
            </div>
            {w.label === '5h Rolling' && w.reset_in_sec > 0 && (
              <div className="text-xs text-subtle mt-0.5">
                {t('dashboard.countdown', { time: fmtTime(w.reset_in_sec) })}
              </div>
            )}
            {w.label !== '5h Rolling' && w.reset_at && (
              <div className="text-xs text-subtle mt-0.5">
                {t('dashboard.resetTime', { date: new Date(w.reset_at).toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US') })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const DONUT_COLORS = ['oklch(0.6 0.15 200)', 'oklch(0.65 0.18 340)'];

function ModelDonut({ models: raw }: { models: { model: string; total_input_tokens: number; total_output_tokens: number; total_cost_usd: number; request_count: number }[] }) {
  const { t } = useTranslation();
  const top = [...raw]
    .sort((a, b) => (b.total_input_tokens + b.total_output_tokens) - (a.total_input_tokens + a.total_output_tokens))
    .slice(0, 3);

  const chartData = [
    { name: 'Input', value: top.reduce((s, m) => s + m.total_input_tokens, 0) },
    { name: 'Output', value: top.reduce((s, m) => s + m.total_output_tokens, 0) },
  ];
  const total = chartData[0].value + chartData[1].value;

  if (top.length === 0) {
    return <div className="text-sm text-base-content/40 text-center py-10">{t('common.noData')}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-6">
        <div className="w-[150px] h-[150px] shrink-0 select-none" role="img" aria-label={`${t('common.input')} ${fmt(chartData[0].value)}; ${t('common.output')} ${fmt(chartData[1].value)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart accessibilityLayer>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={68}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i]} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [fmt(Number(value)), t('dashboard.heroTooltipTokens')]}
                contentStyle={{ background: 'oklch(0.99 0.01 80)', border: '1px solid oklch(0.87 0.01 80)', borderRadius: '8px', fontSize: '12px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 min-w-0 space-y-2.5">
          {top.map((m, i) => (
            <div key={m.model}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-bold text-muted shrink-0 w-4">#{i + 1}</span>
                <ModelIcon model={m.model} />
                <span className="text-sm font-semibold truncate">{m.model}</span>
              </div>
              <div className="text-xs text-muted tabular-nums ml-[22px] mt-0.5 truncate">
                {t('common.input')} {fmt(m.total_input_tokens)} · {t('common.output')} {fmt(m.total_output_tokens)} · {t('dashboard.requests', { count: m.request_count })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-5 pt-2 border-t border-base-200">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: DONUT_COLORS[0] }} />
          <span className="text-[11px] text-base-content/50">{t('common.input')} {fmt(chartData[0].value)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: DONUT_COLORS[1] }} />
          <span className="text-[11px] text-base-content/50">{t('common.output')} {fmt(chartData[1].value)}</span>
        </div>
        <span className="text-xs text-subtle ml-auto shrink-0">{t('common.total')} {fmt(total)}</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [topPeriod, setTopPeriod] = useState<TimeRange>(getStoredTimeRange);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    storeTimeRange(topPeriod);
  }, [topPeriod]);
  const { data, loading, refetch: refetchDashboard } = usePolling((signal) => api.getDashboard('30d', signal), 30000);

  const { data: todayData, refetch: refetchToday } = usePolling(
    (signal) => api.getModelTokenStats(1, undefined, 'today', signal),
    60000,
  );

  const { data: topData, refetch: refetchTop } = usePolling(
    (signal) => api.getModelTokenStats(1, undefined, topPeriod, signal),
    60000,
    true,
    [topPeriod],
  );

  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    let total = 0;
    try {
      const accounts = await api.listOpenCodeAccounts();
      for (const account of accounts) {
        try {
          const synced = await api.syncUsage(account.id);
          total += synced.inserted ?? 0;
          const backfilled = await api.backfillUsage(account.id, { mode: 'days', days: 90 });
          total += backfilled.inserted ?? 0;
        } catch (err) {
          toast(t('dashboard.syncFailed', { error: String(err instanceof Error ? err.message : err) }), 'error');
        }
      }
      toast(t('dashboard.syncDone', { count: total }), 'success');
      refetchDashboard();
      refetchToday();
      refetchTop();
    } finally {
      setSyncing(false);
    }
  };

  const overview = data?.overview?.opencode;
  const quota = (data?.quota ?? []).filter((q) => q.success);
  const tokens = data?.model_tokens ?? [];
  const todayTokens = todayData?.stats ?? [];
  const topTokens = topData?.stats ?? [];
  const unhealthyAccounts = (data?.data_health ?? []).filter(
    (health) => !health.healthy && health.last_sync_status != null,
  );
  const quotaIntelligence = data?.quota_intelligence ?? [];
  const reconciliationEvents = (data?.quota_reconciliation ?? []).filter((event) => event.event_type !== 'matched');
  const recommendation = data?.recommendations;
  useEffect(() => {
    void notifyQuotaAlert(quotaIntelligence, t('dashboard.notificationTitle'));
  }, [quotaIntelligence, t]);
  const tokenBreakdown = {
    uncachedInput: tokens.reduce((s, m) => s + Number(m.uncached_input_tokens ?? m.total_input_tokens ?? 0), 0),
    cacheHit: tokens.reduce((s, m) => s + Number(m.cache_hit_tokens ?? 0), 0),
    cacheWrite: tokens.reduce((s, m) => s + Number(m.cache_write_tokens ?? 0), 0),
    output: tokens.reduce((s, m) => s + m.total_output_tokens, 0),
    reasoning: tokens.reduce((s, m) => s + m.total_reasoning_tokens, 0),
  };

  const hero = useMemo(() => {
    const tkn = tokens.reduce(
      (s, m) => s + m.total_input_tokens + m.total_output_tokens + m.total_reasoning_tokens,
      0,
    );
    const r = tokens.reduce((s, m) => s + m.request_count, 0);
    const today = todayTokens.reduce(
      (s, m) => s + m.total_input_tokens + m.total_output_tokens + m.total_reasoning_tokens,
      0,
    );
    const totalCost = tokens.reduce((s, m) => s + m.total_cost_usd, 0);
    const quotaUnits = data?.quota_units?.total_quota_units;
    return [
      { label: t('dashboard.account'), value: overview?.account_count ?? '-', sub: t('dashboard.availableBlocked', { available: overview?.success_count ?? 0, blocked: overview?.blocked_count ?? 0 }), breakdown: null, size: 'sm' },
      { label: t('dashboard.bottleneckQuota'), value: overview?.bottleneck ? `${overview.bottleneck.remaining}%` : '-', sub: overview?.bottleneck ? `${overview.bottleneck.name} · ${overview.bottleneck.window}` : t('dashboard.noBottleneck'), breakdown: null, size: 'sm' },
      {
        label: t('dashboard.totalTokenConsumption'),
        value: fmt(tkn),
        sub: t('dashboard.requests', { count: r.toLocaleString() }),
        breakdown: tokenBreakdown,
        size: 'md',
      },
      {
        label: t('dashboard.todayTokenUsage'),
        value: todayData ? fmt(today) : '-',
        sub: `${t('dashboard.todayTokenDesc')} · ${new Date().toLocaleDateString(
          i18n.language === 'zh' ? 'zh-CN' : 'en-US',
          { year: 'numeric', month: '2-digit', day: '2-digit' },
        )}`,
        breakdown: null,
        size: 'md',
      },
      {
        label: t('dashboard.totalCost'),
        value: `$${totalCost.toFixed(4)}`,
        sub: t('dashboard.totalCostDesc'),
        breakdown: null,
        size: 'md',
      },
      {
        label: t('dashboard.quotaUnits'),
        value: quotaUnits == null ? '-' : quotaUnits.toFixed(2),
        sub: t('dashboard.quotaUnitsDesc'),
        breakdown: null,
        size: 'md',
      },
    ];
  }, [overview, tokens, todayTokens, data?.quota_units?.total_quota_units, t, i18n.language]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-86px)]">
        <div className="w-48 space-y-2">
          <div className="h-1 bg-base-200 rounded-full overflow-hidden relative">
            <div className="absolute inset-0 h-full bg-gradient-to-r from-primary to-secondary rounded-full animate-loading-bar" />
          </div>
          <p className="text-xs text-muted text-center">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{t('dashboard.title')}</h1>
        <button className="btn btn-primary btn-sm" onClick={handleSyncAll} disabled={syncing}>
          {syncing ? t('dashboard.syncing') : t('dashboard.syncAll')}
        </button>
      </div>

      {unhealthyAccounts.length > 0 && (
        <div className="alert alert-warning py-2.5 text-sm" role="status">
          <div>
            <div className="font-semibold">{t('dashboard.dataHealthWarning')}</div>
            <div className="text-xs opacity-80 mt-0.5">
              {unhealthyAccounts.map((health) => (
                <span key={health.account_id} className="mr-3">
                  {health.account_name}: {health.last_sync_status}
                  {health.last_failed_page != null ? ` · ${t('dashboard.failedPage', { page: health.last_failed_page })}` : ''}
                  {health.last_parse_error_count > 0 ? ` · ${t('dashboard.parseErrors', { count: health.last_parse_error_count })}` : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {(recommendation?.account || recommendation?.model) && (
        <div className="alert border-primary/30 bg-primary/5 py-3" role="status">
          <div>
            <div className="font-semibold">{t('dashboard.recommendationTitle')}</div>
            <div className="text-sm mt-1">
              {recommendation.account && t('dashboard.recommendAccount', {
                account: recommendation.account.name,
                remaining: recommendation.account.bottleneck_remaining,
                reason: t(`dashboard.reason_${recommendation.account.reason_code}`),
              })}
              {recommendation.model && ` · ${t('dashboard.recommendModel', {
                model: recommendation.model.model, weight: recommendation.model.weight,
              })}`}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {hero.map((h) => (
          <div key={h.label} className="border border-base-200 rounded-xl px-3 py-2.5">
            <div className="metric-label tracking-wider truncate">{h.label}</div>
            {h.breakdown ? (
              <TokenBreakdownTooltip {...h.breakdown}>
                <div className={`font-bold mt-0.5 ${h.size === 'sm' ? 'text-xl' : 'text-2xl'}`}>{h.value}</div>
              </TokenBreakdownTooltip>
            ) : (
              <div className={`font-bold mt-0.5 ${h.size === 'sm' ? 'text-xl' : 'text-2xl'}`}>{h.value}</div>
            )}
            <div className="text-xs text-muted mt-0.5 truncate">{h.sub}</div>
          </div>
        ))}
      </div>

      <div className="border border-base-200 rounded-xl p-4">
        <div className="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-3">{t('dashboard.enduranceTitle')}</div>
        {quotaIntelligence.length === 0 ? (
          <div className="text-sm text-muted py-3">{t('dashboard.enduranceNoSnapshots')}</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {quotaIntelligence.slice(0, 3).map((window) => (
              <div key={`${window.account_id}:${window.window_label}`} className="rounded-lg border border-base-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{window.account_name}</span>
                  <div className="flex items-center gap-1">
                    <span className={`badge badge-sm ${window.alert_level === 'critical' ? 'badge-error' : window.alert_level === 'warning' ? 'badge-warning' : 'badge-ghost'}`}>{t(`dashboard.alert_${window.alert_level}`)}</span>
                    <span className="badge badge-ghost badge-sm">{window.window_label}</span>
                  </div>
                </div>
                {window.hours_to_exhaust == null ? (
                  <div className="text-sm text-muted mt-2">{t('dashboard.enduranceInsufficient')}</div>
                ) : (
                  <>
                    <div className={`text-lg font-bold mt-2 ${window.can_last_until_reset ? 'text-success' : 'text-error'}`}>
                      {window.can_last_until_reset ? t('dashboard.enduranceCanLast') : t('dashboard.enduranceCannotLast')}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {t('dashboard.enduranceHours', { exhaust: window.hours_to_exhaust, reset: window.hours_to_reset })}
                    </div>
                  </>
                )}
                <div className="text-xs text-subtle mt-2">{t('dashboard.enduranceConfidence', { level: t(`dashboard.confidence_${window.confidence}`), count: window.sample_count })}</div>
                <div className="text-xs text-muted mt-1">{t('dashboard.safeBudget', { budget: window.safe_budget_per_day, reserve: window.reserve_percent })}</div>
                {window.acceleration_ratio != null && window.acceleration_ratio >= 1.5 && (
                  <div className="text-xs text-warning mt-1" role="status">{t('dashboard.accelerationWarning', { ratio: window.acceleration_ratio })}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {reconciliationEvents.length > 0 && (
        <div className="border border-base-200 rounded-xl p-4">
          <div className="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-3">{t('dashboard.reconciliationTitle')}</div>
          <div className="space-y-2">
            {reconciliationEvents.slice(0, 5).map((event) => (
              <div key={`${event.account_id}:${event.window_label}:${event.to}`} className="flex items-center gap-3 text-sm">
                <span className="badge badge-outline badge-sm">{t(`dashboard.reconcile_${event.event_type}`)}</span>
                <span className="font-medium">{event.account_name} · {event.window_label}</span>
                <span className="text-muted ml-auto">{new Date(event.to).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-4">
        <div className="flex-1 border border-base-200 rounded-xl p-4 flex flex-col min-h-0">
          <div className="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-3 shrink-0">{t('dashboard.accountQuotaStatus')}</div>
          {quota.length === 0 ? (
            <div className="text-sm text-base-content/40 text-center py-6">{t('common.noData')}</div>
          ) : (
            <div className="flex-1 max-h-[280px] overflow-y-auto space-y-4 pr-1">
              {quota.map((q) => (
                <div key={q.account_id}>
                  <div className="text-sm font-semibold text-base-content/70 mb-2">{q.name}</div>
                  <QuotaBar windows={q.windows} />
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-subtle mt-3 pt-3 border-t border-base-200 shrink-0">
            {quota.some((q) => q.windows.some((w) => w.used >= 100))
              ? t('dashboard.partialExhausted')
              : quota.some((q) => q.windows.some((w) => w.used >= 80))
              ? t('dashboard.partialWarning')
              : t('dashboard.allGood')}
          </div>
        </div>

        <div className="flex-1 border border-base-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-base-content/50 uppercase tracking-wider">{t('dashboard.modelTop3')}</div>
            <TimeRangeTabs value={topPeriod} onChange={setTopPeriod} size="xs" />
          </div>
          <ModelDonut models={topTokens} />
          <div className="text-xs text-subtle mt-3 pt-3 border-t border-base-200">
            {topTokens.length > 0
              ? t('dashboard.mostConsumed', {
                  model: topTokens[0]?.model ?? '',
                  percent: topTokens[0] ? ((topTokens[0].total_input_tokens + topTokens[0].total_output_tokens) / (topTokens.reduce((s, m) => s + m.total_input_tokens + m.total_output_tokens, 0)) * 100).toFixed(1) : 0,
                })
              : t('dashboard.noModelData')}
          </div>
        </div>
      </div>

      <div className="border border-base-200 rounded-xl p-4">
        <div className="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-3">{t('dashboard.recentUsage')}</div>
        <UsageTable records={data?.recent_usage?.records ?? []} showAccount />
      </div>
    </div>
  );
}
