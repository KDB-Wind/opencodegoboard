import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCookieHeader,
  extractWorkspaceId,
  fetchWorkspaceRefs,
  parseQuotaHtml,
  resolveWorkspaceId,
} from './quota';

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');
}

describe('quota response parsing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses both field orders, clamps percentages, and calculates reset time', () => {
    const now = new Date('2026-08-15T00:00:00.000Z');
    const windows = parseQuotaHtml(fixture('quota-response.txt'), now);

    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({
      label: '5h Rolling',
      used: 23.5,
      remaining: 76.5,
      reset_in_sec: 3600,
      reset_at: '2026-08-15T01:00:00Z',
    });
    expect(windows[1]).toMatchObject({ label: 'Weekly', used: 81.25 });
    expect(windows[2]).toMatchObject({ label: 'Monthly', used: 100, remaining: 0 });
  });

  it('extracts and resolves workspace references from a server-fn fixture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(fixture('workspace-response.txt'), { status: 200 })),
    );

    await expect(fetchWorkspaceRefs('secret')).resolves.toEqual([
      ['wrk_alpha', 'Alpha Team'],
      ['wrk_beta', 'Beta Team'],
    ]);
    await expect(resolveWorkspaceId('Beta Team', 'secret')).resolves.toBe('wrk_beta');
  });

  it('normalizes cookie and direct workspace input without network access', async () => {
    expect(buildCookieHeader('Cookie: other=1; auth=abc; x=2')).toBe('auth=abc');
    expect(extractWorkspaceId('https://opencode.ai/workspace/wrk_123ABC/go')).toBe('wrk_123ABC');
    await expect(resolveWorkspaceId('wrk_direct', '')).resolves.toBe('wrk_direct');
  });
});
