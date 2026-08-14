import { useTranslation } from 'react-i18next';
import type { ModelTokenStat } from '../api/types';
import { ModelIcon } from './ModelIcon';

interface ModelRankListProps {
  data: ModelTokenStat[];
}

function formatTokens(v: number) {
  if (v >= 1_000_000_000_000) return (v / 1_000_000_000_000).toFixed(2) + 'T';
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
}

export function ModelRankList({ data }: ModelRankListProps) {
  const { t } = useTranslation();

  const ranked = [...data].sort(
    (a, b) =>
      b.total_input_tokens +
      b.total_output_tokens -
      (a.total_input_tokens + a.total_output_tokens),
  );
  const grandTotal = ranked.reduce((s, m) => s + m.total_input_tokens + m.total_output_tokens, 0);

  if (ranked.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-base-content/40 text-sm">
        {t('common.noData')}
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {ranked.map((m, i) => {
        const input = m.total_input_tokens;
        const output = m.total_output_tokens;
        const total = input + output;
        const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
        const barWidth = Math.max(pct, 2);
        return (
          <li
            key={m.model}
            className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-base-200/50 transition-colors"
          >
            <span
              className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-[11px] font-bold tabular-nums ${
                i === 0
                  ? 'bg-primary text-primary-content'
                  : i === 1
                    ? 'bg-base-300 text-base-content/70'
                    : 'bg-base-200 text-base-content/40'
              }`}
            >
              {i + 1}
            </span>
            <ModelIcon model={m.model} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold truncate">{m.model}</span>
                <span className="text-xs text-base-content/60 tabular-nums whitespace-nowrap">
                  {t('common.input')} {formatTokens(input)} · {t('common.output')}{' '}
                  {formatTokens(output)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 bg-base-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-base-content/40">
                  {t('tokenStats.pctOfTotal', { pct: pct.toFixed(1) })}
                </span>
                <span className="text-[10px] text-base-content/40">
                  {t('tokenStats.requestsIn', { count: m.request_count.toLocaleString() })}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
