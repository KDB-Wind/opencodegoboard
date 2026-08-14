import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface TokenBreakdownTooltipProps {
  children: ReactNode;
  uncachedInput: number;
  cacheHit: number;
  cacheWrite: number;
  output: number;
}

export function TokenBreakdownTooltip({
  children,
  uncachedInput,
  cacheHit,
  cacheWrite,
  output,
}: TokenBreakdownTooltipProps) {
  const { t } = useTranslation();
  const totalInput = uncachedInput + cacheHit + cacheWrite;
  const hitRate = totalInput > 0 ? ((cacheHit / totalInput) * 100).toFixed(1) : '0.0';
  const format = (value: number) => value.toLocaleString();

  return (
    <div className="relative group cursor-help w-fit">
      {children}
      <div className="absolute right-0 top-full mt-2 z-30 hidden group-hover:block w-52 rounded-lg border border-base-300 bg-base-100 p-3 text-xs shadow-lg">
        <div className="font-semibold mb-2">{t('tokenStats.breakdownTitle')}</div>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-base-content/60">{t('tokenStats.uncachedInput')}</span>
          <span className="tabular-nums">{format(uncachedInput)}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-base-content/60">{t('tokenStats.cacheHit')}</span>
          <span className="tabular-nums">{format(cacheHit)}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-base-content/60">{t('tokenStats.cacheWrite')}</span>
          <span className="tabular-nums">{format(cacheWrite)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-base-200 mt-1 pt-1">
          <span className="text-base-content/60">{t('tokenStats.totalInput')}</span>
          <span className="tabular-nums">{format(totalInput)}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-base-content/60">{t('tokenStats.output')}</span>
          <span className="tabular-nums">{format(output)}</span>
        </div>
        <div className="text-base-content/40 mt-1">{t('tokenStats.cacheHitRate', { rate: hitRate })}</div>
      </div>
    </div>
  );
}
