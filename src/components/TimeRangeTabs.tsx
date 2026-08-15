import { useTranslation } from 'react-i18next';

export type TimeRange = 'today' | '7d' | '30d' | 'all' | 'custom';

export const TIME_RANGE_STORAGE_KEY = 'opencodeboard.timeRange';

export function getStoredTimeRange(): TimeRange {
  if (typeof window === 'undefined') return '30d';
  const value = window.localStorage.getItem(TIME_RANGE_STORAGE_KEY);
  return value === 'today' || value === '7d' || value === '30d' || value === 'all' || value === 'custom'
    ? value
    : '30d';
}

export function storeTimeRange(value: TimeRange) {
  window.localStorage.setItem(TIME_RANGE_STORAGE_KEY, value);
}

interface TimeRangeTabsProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
  size?: 'sm' | 'xs';
  allowCustom?: boolean;
}

const OPTIONS: { value: TimeRange; i18nKey: string }[] = [
  { value: 'today', i18nKey: 'timeRange.today' },
  { value: '7d', i18nKey: 'timeRange.7days' },
  { value: '30d', i18nKey: 'timeRange.30days' },
  { value: 'all', i18nKey: 'timeRange.all' },
  { value: 'custom', i18nKey: 'timeRange.custom' },
];

export function TimeRangeTabs({ value, onChange, size = 'sm', allowCustom = false }: TimeRangeTabsProps) {
  const { t } = useTranslation();
  const compact = size === 'xs';
  const options = allowCustom ? OPTIONS : OPTIONS.filter((option) => option.value !== 'custom');
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg bg-base-200 ${compact ? 'p-0.5' : 'p-1'}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={`rounded-md font-medium transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-base-200 ${
            compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'
          } ${
            value === o.value
              ? 'bg-primary text-primary-content shadow-sm'
              : 'text-base-content/60 hover:bg-base-100/70 hover:text-base-content'
          }`}
          onClick={() => onChange(o.value)}
        >
          {t(o.i18nKey)}
        </button>
      ))}
    </div>
  );
}
