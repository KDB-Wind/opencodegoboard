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

export function DailyChart({ data, mode, hourly = false }: DailyChartProps) {
  const { t } = useTranslation();

  const rawData = [...data].reverse().map((d) => ({
    date: hourly ? d.date.slice(11, 16) : d.date.slice(5),
    fullDate: d.date,
    cost: Math.round(d.total_cost_usd * 1000000) / 1000000,
    requests: d.request_count,
    tokens: d.total_input_tokens + d.total_output_tokens + d.total_reasoning_tokens,
  }));
  const maxima = {
    cost: Math.max(...rawData.map((d) => d.cost), 0),
    requests: Math.max(...rawData.map((d) => d.requests), 0),
    tokens: Math.max(...rawData.map((d) => d.tokens), 0),
  };
  const chartData = rawData.map((d) => ({
    ...d,
    costNormalized: maxima.cost ? d.cost / maxima.cost * 100 : 0,
    requestsNormalized: maxima.requests ? d.requests / maxima.requests * 100 : 0,
    tokensNormalized: maxima.tokens ? d.tokens / maxima.tokens * 100 : 0,
  }));

  const formatValue = (v: number) => {
    if (mode === 'cost') return '$' + v.toFixed(4);
    if (mode === 'compare') return `${Math.round(v)}%`;
    return v.toLocaleString();
  };

  return (
    <ResponsiveContainer width="100%" height={320} className="select-none">
      <LineChart data={chartData} margin={{ left: 10 }}>
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
            if (name === 'cost') return ['$' + v.toFixed(4), t('tokenStats.trendTooltipCost')];
            if (name === 'tokens') return [v.toLocaleString(), t('tokenStats.trendTokens')];
            if (name === 'costNormalized') return [`${v.toFixed(0)}%`, t('tokenStats.trendCost')];
            if (name === 'requestsNormalized') return [`${v.toFixed(0)}%`, t('tokenStats.trendRequests')];
            if (name === 'tokensNormalized') return [`${v.toFixed(0)}%`, t('tokenStats.trendTokens')];
            return [v, t('tokenStats.trendTooltipRequests')];
          }}
          labelFormatter={(label) => {
            const match = chartData.find((d) => d.date === label);
            return match?.fullDate || label;
          }}
        />
        {mode === 'compare' ? (
          <>
            <Line type="monotone" dataKey="costNormalized" stroke="oklch(0.58 0.20 340)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="requestsNormalized" stroke="oklch(0.62 0.17 230)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="tokensNormalized" stroke="oklch(0.65 0.17 145)" strokeWidth={2} dot={false} />
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
  );
}
