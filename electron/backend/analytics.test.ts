import { describe, expect, it } from 'vitest';
import { aggregateOpencode } from './analytics';

describe('account quota bottlenecks', () => {
  it('surfaces the tightest window instead of hiding it behind an average', () => {
    const overview = aggregateOpencode([
      { account_id: 'a', name: 'A', success: true, windows: [
        { label: '5h Rolling', used: 90, remaining: 10 },
        { label: 'Weekly', used: 20, remaining: 80 },
        { label: 'Monthly', used: 10, remaining: 90 },
      ] },
      { account_id: 'b', name: 'B', success: true, windows: [
        { label: '5h Rolling', used: 30, remaining: 70 },
        { label: 'Weekly', used: 30, remaining: 70 },
      ] },
    ]);
    expect(overview.bottleneck).toEqual({ account_id: 'a', name: 'A', window: '5h Rolling', remaining: 10 });
    expect((overview.accounts as Array<Record<string, unknown>>)[0]).toMatchObject({
      bottleneck_window: '5h Rolling', bottleneck_remaining: 10,
    });
  });
});
