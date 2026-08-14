import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchUsagePage: vi.fn(),
  insertUsageRecordsIgnore: vi.fn(() => 1),
  updateUsageSyncState: vi.fn(),
  refreshUsageSyncTotals: vi.fn(),
  progressError: vi.fn(),
}));

vi.mock('./opencode-usage', () => ({
  USAGE_PAGE_SIZE: 50,
  fetchUsagePage: mocks.fetchUsagePage,
  resolveAccountWorkspaceId: vi.fn(async () => 'wrk_test'),
  toDbDict: (record: unknown) => record,
}));

vi.mock('./config', () => ({
  loadServiceConfig: () => ({
    usage_sync: {
      max_pages_per_incremental: 10,
      backfill_pages_per_request: 10,
    },
  }),
}));

vi.mock('./db', () => ({
  getUsageSyncState: () => ({ deepest_page_fetched: -1 }),
  updateOpencodeAccount: vi.fn(),
  insertUsageRecordsIgnore: mocks.insertUsageRecordsIgnore,
  updateUsageSyncState: mocks.updateUsageSyncState,
  refreshUsageSyncTotals: mocks.refreshUsageSyncTotals,
}));

vi.mock('./sync-progress', () => ({
  start: vi.fn(),
  update: vi.fn(),
  finish: vi.fn(),
  error: mocks.progressError,
}));

import { backfillUsage } from './usage-sync';

const account = {
  id: 'account-1',
  name: 'Test',
  workspace_id: 'Default',
  resolved_workspace_id: 'wrk_test',
  auth_cookie: 'secret',
  show_rolling: true,
  show_weekly: true,
  show_monthly: true,
  enabled: true,
  created_at: '2026-08-14T00:00:00Z',
  updated_at: '2026-08-14T00:00:00Z',
};

function fullPage(page: number, createdAt = '2026-08-14T00:00:00Z') {
  return Array.from({ length: 50 }, (_, index) => ({ usg_id: `usg_${page}_${index}`, created_at: createdAt }));
}

describe('backfillUsage failure boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertUsageRecordsIgnore.mockReturnValue(1);
  });

  it('does not write any page from a batch containing a failed request', async () => {
    mocks.fetchUsagePage.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 1) throw new Error('network down');
      return fullPage(page);
    });

    await expect(backfillUsage(account, 5)).rejects.toThrow('第 1 页同步失败');

    expect(mocks.insertUsageRecordsIgnore).not.toHaveBeenCalled();
    expect(mocks.updateUsageSyncState).toHaveBeenLastCalledWith(
      account.id,
      expect.objectContaining({
        last_sync_status: 'error',
        last_inserted_count: 0,
      }),
    );
  });

  it('keeps completed batches and marks a later failure as partial', async () => {
    mocks.fetchUsagePage.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 6) throw new Error('temporary failure');
      return fullPage(page);
    });

    await expect(backfillUsage(account, 10)).rejects.toThrow('第 6 页同步失败');

    expect(mocks.insertUsageRecordsIgnore).toHaveBeenCalledTimes(5);
    expect(mocks.updateUsageSyncState).toHaveBeenCalledWith(account.id, {
      deepest_page_fetched: 4,
    });
    expect(mocks.updateUsageSyncState).toHaveBeenLastCalledWith(
      account.id,
      expect.objectContaining({
        last_sync_status: 'partial',
        last_inserted_count: 5,
      }),
    );
  });

  it('stops exactly on a short terminal page and records that page as deepest', async () => {
    mocks.fetchUsagePage.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 2) return [{ usg_id: 'usg_terminal' }];
      return fullPage(page);
    });

    await expect(backfillUsage(account, 10)).resolves.toMatchObject({
      pages_fetched: 3,
      inserted: 3,
    });

    expect(mocks.insertUsageRecordsIgnore).toHaveBeenCalledTimes(3);
    expect(mocks.updateUsageSyncState).toHaveBeenCalledWith(account.id, {
      deepest_page_fetched: 2,
    });
  });

  it('stops writing later pages once the requested date is reached', async () => {
    mocks.fetchUsagePage.mockImplementation(async ({ page }: { page: number }) =>
      fullPage(page, `2026-08-${String(15 - page).padStart(2, '0')}T00:00:00Z`));

    await expect(backfillUsage(account, 10, { mode: 'until', until: '2026-08-13' }))
      .resolves.toMatchObject({ pages_fetched: 3, inserted: 3 });
    expect(mocks.insertUsageRecordsIgnore).toHaveBeenCalledTimes(3);
    expect(mocks.updateUsageSyncState).toHaveBeenCalledWith(account.id, {
      deepest_page_fetched: 2,
    });
  });
});
