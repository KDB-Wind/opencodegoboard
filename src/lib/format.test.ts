import { describe, expect, it } from 'vitest';
import { formatPercent } from './format';

describe('formatPercent', () => {
  it('hides floating-point noise while keeping useful precision', () => {
    expect(formatPercent(4.599999999999999)).toBe('4.6%');
    expect(formatPercent(95)).toBe('95%');
  });

  it('falls back for non-finite values', () => {
    expect(formatPercent(Number.NaN)).toBe('-');
  });
});
