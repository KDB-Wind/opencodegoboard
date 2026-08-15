import { useTranslation } from 'react-i18next';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DailyStat } from '../api/types';

interface DailyChartProps {
  data: DailyStat[];
  mode: 'cost' | 'requests' | 'tokens' | 'compare';
  hourly?: boolean;
}

const roundUsd = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

export function DailyChart({ data, mode, hourly = false }: DailyChartProps) {
  const { t } = useTranslation();

  const rawData = [...data].reverse().map((d) => ({
    date: hourly ? d.date : d.date.slice(5),
    fullDate: d.date,
    cost: roundUsd(d.total_cost_usd),
    equivalent: roundUsd(d.equivalent_cost_usd ?? 0),
    requests: d.request_count,
    tokens: d.total_input_tokens + d.total_output_tokens + d.total_reasoning_tokens,
  }));

  const modeLabel =
    mode === 'compare' ? t('tokenStats.trendEquivalentCompare')
    : mode === 'cost' ? t('tokenStats.trendCost')
    : mode === 'tokens' ? t('tokenStats.trendTokens')
    : t('tokenStats.trendRequests');

  const formatValue = (v: number) => {
    if (mode === 'cost' || mode === 'compare') return '$' + v.toFixed(4);
    return v.toLocaleString();
  };

  return (
    <div role="img" aria-label={t('tokenStats.chartDescription', { mode: modeLabel, count: rawData.length })}>
      {mode === 'compare' && (
        <div className="flex flex-wrap gap-4 text-xs text-muted mb-2" aria-hidden="true">
          <span>━━ {t('tokenStats.trendActualCost')}</span>
          <span>┅┅ {t('tokenStats.trendEquivalentCost')}</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={320} className="select-none">
      <LineChart accessibilityLayer data={rawData} margin={{ left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.87 0.01 80)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'oklch(0.5 0.02 80)' }}
          axisLine={{ stroke: 'oklch(0.87 0.01 80)' }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatValue}
          tick={{ fontSize: 11, fill: 'oklch(0.5 0.02 80)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'oklch(0.99 0.01 80)',
            border: '1px solid oklch(0.87 0.01 80)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value, name) => {
            const v = Number(value);
            if (name === 'cost') return ['$' + v.toFixed(4), t('tokenStats.trendActualCost')];
            if (name === 'equivalent') return ['$' + v.toFixed(4), t('tokenStats.trendEquivalentCost')];
            if (name === 'tokens') return [v.toLocaleString(), t('tokenStats.trendTokens')];
            return [v.toLocaleString(), t('tokenStats.trendTooltipRequests')];
          }}
          labelFormatter={(label) => {
            const match = rawData.find((d) => d.date === label);
            return match?.fullDate || label;
          }}
        />
        {mode === 'compare' ? (
          <>
            <Line type="monotone" dataKey="cost" stroke="oklch(0.58 0.20 340)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'oklch(0.58 0.20 340)' }} />
            <Line type="monotone" dataKey="equivalent" stroke="oklch(0.62 0.17 230)" strokeDasharray="8 4" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'oklch(0.62 0.17 230)' }} />
          </>
        ) : (
          <Line
            type="monotone"
            dataKey={mode}
            stroke="oklch(0.6 0.18 340)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'oklch(0.6 0.18 340)' }}
          />
        )}
      </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
