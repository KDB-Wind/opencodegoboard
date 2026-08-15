import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';
import type { ModelTokenStat, OpenCodeAccount } from '../api/types';
import { ModelIcon } from '../components/ModelIcon';
import { ModelRankList } from '../components/ModelRankList';
import { TokenBreakdownTooltip } from '../components/TokenBreakdownTooltip';
import { DailyChart } from '../components/DailyChart';
import { getStoredTimeRange, storeTimeRange, TimeRangeTabs, type TimeRange } from '../components/TimeRangeTabs';

const PERIOD_MAP: Record<TimeRange, string> = {
  today: 'today',
  '7d': '7d',
  '30d': '30d',
  all: 'all',
  custom: '30d',
};

const TREND_DAYS: Record<TimeRange, number> = {
  today: 0,
  '7d': 7,
  '30d': 30,
  all: 365,
  custom: 0,
};

const CUSTOM_FROM_KEY = 'opencodeboard.customFrom';
const CUSTOM_TO_KEY = 'opencodeboard.customTo';

function localDateString(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isDateString(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getStoredCustomRange(): { from: string; to: string } {
  const fallback = { from: localDateString(-1), to: localDateString(-1) };
  if (typeof window === 'undefined') return fallback;
  const from = window.localStorage.getItem(CUSTOM_FROM_KEY);
  const to = window.localStorage.getItem(CUSTOM_TO_KEY);
  if (isDateString(from) && isDateString(to) && from <= to) return { from, to };
  return fallback;
}

function storeCustomRange(range: { from: string; to: string }) {
  window.localStorage.setItem(CUSTOM_FROM_KEY, range.from);
  window.localStorage.setItem(CUSTOM_TO_KEY, range.to);
}

export function TokenStats() {
  const { t } = useTranslation();
  const [range, setRange] = useState<TimeRange>(getStoredTimeRange);
  const [customRange, setCustomRange] = useState(getStoredCustomRange);
  const [accountId, setAccountId] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<'cost' | 'requests' | 'tokens' | 'compare'>('cost');

  useEffect(() => {
    storeTimeRange(range);
  }, [range]);

  useEffect(() => {
    storeCustomRange(customRange);
  }, [customRange]);

  const { data: accounts } = usePolling((signal) => api.listOpenCodeAccounts(signal), 120000);

  const aid = accountId || undefined;
  const custom = range === 'custom';
  const customFrom = custom ? customRange.from : undefined;
  const customTo = custom ? customRange.to : undefined;
  const { data: modelTokens } = usePolling(
    (signal) => api.getModelTokenStats(1, aid, custom ? undefined : PERIOD_MAP[range], signal, customFrom, customTo),
    60000,
    true,
    [range, aid, customRange.from, customRange.to],
  );

  const { data: trendData } = usePolling(
    (signal) => api.getDailyStats(TREND_DAYS[range], aid, signal, customFrom, customTo),
    60000,
    range !== 'today',
    [range, aid, customRange.from, customRange.to],
  );
  const { data: hourlyData } = usePolling(
    (signal) => api.getHourlyStats(aid, signal),
    60000,
    range === 'today',
    [aid],
  );

  const stats = modelTokens?.stats ?? [];
  const trendStats = range === 'today' ? hourlyData?.stats ?? [] : trendData?.stats ?? [];

  const modelOptions = Array.from(new Set(stats.map((m) => m.model))).sort();
  const filteredStats = model ? stats.filter((m) => m.model === model) : stats;

  const totalInput = filteredStats.reduce((s, m) => s + m.total_input_tokens, 0);
  const totalOutput = filteredStats.reduce((s, m) => s + m.total_output_tokens, 0);
  const totalReasoning = filteredStats.reduce((s, m) => s + m.total_reasoning_tokens, 0);
  const totalCost = filteredStats.reduce((s, m) => s + m.total_cost_usd, 0);
  const totalRequests = filteredStats.reduce((s, m) => s + m.request_count, 0);
  const uncachedInput = filteredStats.reduce((s, m) => s + Number(m.uncached_input_tokens ?? m.total_input_tokens ?? 0), 0);
  const cacheHit = filteredStats.reduce((s, m) => s + Number(m.cache_hit_tokens ?? 0), 0);
  const cacheWrite = filteredStats.reduce((s, m) => s + Number(m.cache_write_tokens ?? 0), 0);
  const cacheHitRate = uncachedInput + cacheHit + cacheWrite > 0
    ? ((cacheHit / (uncachedInput + cacheHit + cacheWrite)) * 100).toFixed(1)
    : '0.0';

  const formatTokens = (v: number) => {
    if (v >= 1_000_000_000_000) return (v / 1_000_000_000_000).toFixed(2) + 'T';
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
    if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
    return v.toString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{t('tokenStats.title')}</h1>
          <p className="text-xs text-muted mt-1">{t('tokenStats.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="select select-bordered select-sm w-36"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">{t('common.allAccounts')}</option>
            {(accounts ?? []).map((a: OpenCodeAccount) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select
            className="select select-bordered select-sm w-44"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">{t('common.allModels')}</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <TimeRangeTabs value={range} onChange={setRange} allowCustom />
          {range === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="input input-bordered input-sm w-36"
                aria-label={t('timeRange.customFrom')}
                value={customRange.from}
                max={customRange.to}
                onChange={(e) => setCustomRange((prev) => {
                  const from = e.target.value || prev.from;
                  return { from, to: from > prev.to ? from : prev.to };
                })}
              />
              <span className="text-xs text-muted">→</span>
              <input
                type="date"
                className="input input-bordered input-sm w-36"
                aria-label={t('timeRange.customTo')}
                value={customRange.to}
                min={customRange.from}
                onChange={(e) => setCustomRange((prev) => ({ ...prev, to: e.target.value || prev.to }))}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-8 gap-4 text-sm">
        {[
          { label: t('tokenStats.totalRequests'), value: totalRequests.toLocaleString() },
          {
            label: t('common.totalTokens'),
            value: formatTokens(totalInput + totalOutput + totalReasoning),
            breakdown: {
              uncachedInput,
              cacheHit,
              cacheWrite,
              output: totalOutput,
              reasoning: totalReasoning,
            },
          },
          { label: t('dailyTrends.totalOutput'), value: formatTokens(totalOutput) },
          { label: t('tokenStats.reasoning'), value: formatTokens(totalReasoning) },
          { label: t('dailyTrends.cacheTokens'), value: formatTokens(cacheHit) },
          { label: t('tokenStats.cacheHitRateLabel'), value: `${cacheHitRate}%` },
          { label: t('tokenStats.totalCost'), value: `$${totalCost.toFixed(4)}` },
          { label: t('tokenStats.equivalentCost'), value: `$${(modelTokens?.equivalent_cost_usd ?? 0).toFixed(4)}` },
        ].map((item) => (
          <div key={item.label} className="border border-base-200 rounded-lg px-4 py-2.5 flex-1">
            <div className="metric-label">{item.label}</div>
            {item.breakdown ? (
              <TokenBreakdownTooltip {...item.breakdown}>
                <div className="text-lg font-bold mt-0.5">{item.value}</div>
              </TokenBreakdownTooltip>
            ) : (
              <div className="text-lg font-bold mt-0.5">{item.value}</div>
            )}
          </div>
        ))}
      </div>

      <div className="border border-base-200 rounded-xl overflow-hidden">
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-base-content/50 uppercase">{t('tokenStats.modelUsage')}</h3>
            <span className="text-xs text-subtle">{t('tokenStats.modelCount', { count: filteredStats.length })}</span>
          </div>
          <ModelRankList data={filteredStats} />
        </div>
      </div>

      <div className="border border-base-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr className="text-base-content/40 text-xs uppercase tracking-wider">
                <th>{t('common.model')}</th>
                <th className="text-right">{t('common.requests')}</th>
                <th className="text-right">{t('common.input')}</th>
                <th className="text-right">{t('common.output')}</th>
                <th className="text-right">{t('tokenStats.reasoning')}</th>
                <th className="text-right">{t('dailyTrends.cacheTokens')}</th>
                <th className="text-right">{t('dailyTrends.cacheRate')}</th>
                <th className="text-right">{t('common.totalTokens')}</th>
                <th className="text-right">{t('common.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredStats.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-base-content/40 text-sm">
                    {t('common.noData')}
                  </td>
                </tr>
              ) : (
                filteredStats.map((m: ModelTokenStat) => (
                  <tr key={m.model} className="hover">
                    <td className="text-sm font-medium">
                      <div className="flex items-center gap-1.5">
                        <ModelIcon model={m.model} />
                        <span>{m.model}</span>
                      </div>
                    </td>
                    <td className="text-right text-sm tabular-nums">{m.request_count.toLocaleString()}</td>
                    <td className="text-right text-sm tabular-nums">{formatTokens(m.total_input_tokens)}</td>
                    <td className="text-right text-sm tabular-nums">{formatTokens(m.total_output_tokens)}</td>
                    <td className="text-right text-sm tabular-nums">{formatTokens(m.total_reasoning_tokens)}</td>
                    <td className="text-right text-sm tabular-nums">{formatTokens(m.cache_hit_tokens ?? 0)}</td>
                    <td className="text-right text-sm tabular-nums">
                      {m.uncached_input_tokens + (m.cache_hit_tokens ?? 0) + (m.cache_write_tokens ?? 0) > 0
                        ? `${(((m.cache_hit_tokens ?? 0) / (m.uncached_input_tokens + (m.cache_hit_tokens ?? 0) + (m.cache_write_tokens ?? 0))) * 100).toFixed(1)}%`
                        : '0.0%'}
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {formatTokens(m.total_input_tokens + m.total_output_tokens + m.total_reasoning_tokens)}
                    </td>
                    <td className="text-right text-sm tabular-nums">${m.total_cost_usd.toFixed(4)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-base-content/50 uppercase">{t('tokenStats.trendTitle')}</h3>
            <div className="tabs tabs-box bg-base-200 p-1">
              <button
                type="button"
                aria-pressed={mode === 'cost'}
                className={`rounded-md font-medium transition-colors whitespace-nowrap px-2 py-0.5 text-[11px] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-base-200 ${mode === 'cost'
                  ? 'bg-primary text-primary-content shadow-sm'
                  : 'text-base-content/60 hover:bg-base-100/70 hover:text-base-content'}`}
                onClick={() => setMode('cost')}
              >
                {t('tokenStats.trendCost')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'tokens'}
                className={`rounded-md font-medium transition-colors whitespace-nowrap px-2 py-0.5 text-[11px] ${mode === 'tokens' ? 'bg-primary text-primary-content shadow-sm' : 'text-base-content/60 hover:bg-base-100/70'}`}
                onClick={() => setMode('tokens')}
              >
                {t('tokenStats.trendTokens')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'compare'}
                className={`rounded-md font-medium transition-colors whitespace-nowrap px-2 py-0.5 text-[11px] ${mode === 'compare' ? 'bg-primary text-primary-content shadow-sm' : 'text-base-content/60 hover:bg-base-100/70'}`}
                onClick={() => setMode('compare')}
              >
                {t('tokenStats.trendEquivalentCompare')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'requests'}
                className={`rounded-md font-medium transition-colors whitespace-nowrap px-2 py-0.5 text-[11px] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-base-200 ${mode === 'requests'
                  ? 'bg-primary text-primary-content shadow-sm'
                  : 'text-base-content/60 hover:bg-base-100/70 hover:text-base-content'}`}
                onClick={() => setMode('requests')}
              >
                {t('tokenStats.trendRequests')}
              </button>
            </div>
          </div>

          <div className="border border-base-200 rounded-xl overflow-hidden">
            <div className="p-4">
              {trendStats.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-base-content/40 text-sm">
                  {t('common.noData')}
                </div>
              ) : (
                <DailyChart data={trendStats} mode={mode} hourly={range === 'today'} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
