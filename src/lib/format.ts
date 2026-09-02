export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return `${Number(value.toFixed(1))}%`;
}
