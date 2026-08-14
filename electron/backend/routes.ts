import { Hono } from 'hono';
import { createHash, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import fs from 'fs';
import * as db from './db';
import { ensureBootstrapped } from './bootstrap';
import { buildOverview } from './analytics';
import {
  loadServiceConfig,
  maskCookie,
  saveSettingsPayload,
  updateServiceConfig,
  type AccountConfig,
} from './config';
import { resolveAccountWorkspaceId } from './opencode-usage';
import { fetchAllQuotas, fetchQuotaForAccount, quotaAccountToDict } from './quota';
import * as syncProgress from './sync-progress';
import { backfillUsage, syncResultToDict, syncUsage } from './usage-sync';
import { analyzeQuotaWindows, reconcileQuotaWindows } from './quota-intelligence';

const OpenCodeAccountCreate = z.object({
  name: z.string(),
  workspace_id: z.string().optional().default('Default'),
  auth_cookie: z.string(),
  show_rolling: z.boolean().optional().default(true),
  show_weekly: z.boolean().optional().default(true),
  show_monthly: z.boolean().optional().default(true),
  enabled: z.boolean().optional().default(true),
});

const OpenCodeAccountUpdate = z.object({
  name: z.string().optional(),
  workspace_id: z.string().optional(),
  auth_cookie: z.string().optional(),
  show_rolling: z.boolean().optional(),
  show_weekly: z.boolean().optional(),
  show_monthly: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const ServiceConfigUpdate = z.object({
  refresh: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  usage_sync: z
    .object({
      auto_sync: z.boolean().optional(),
      interval_sec: z.number().optional(),
      backfill_pages_per_request: z.number().optional(),
      max_pages_per_incremental: z.number().optional(),
    })
    .optional(),
  opencode: z
    .object({
      usage_server_id: z.string().optional(),
    })
    .optional(),
});

const QuotaWeightRuleCreate = z.object({
  account_id: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  model_pattern: z.string().min(1).default('*'),
  weight: z.number().positive(),
  effective_from: z.string().datetime(),
});
const SessionContextUpdate = z.object({
  account_id: z.string(), session_id: z.string().min(1),
  project_name: z.string().nullable().optional(), project_path: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
});

function opencodeAccountDict(row: db.OpenCodeAccountRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    workspace_id: row.workspace_id,
    resolved_workspace_id: row.resolved_workspace_id,
    auth_cookie_masked: maskCookie(row.auth_cookie),
    configured: Boolean(row.auth_cookie.trim()),
    show_rolling: row.show_rolling,
    show_weekly: row.show_weekly,
    show_monthly: row.show_monthly,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildConfigResponse(): Record<string, unknown> {
  const service = loadServiceConfig();
  return {
    refresh: {
      opencode_go: {
        auto_refresh: service.refresh_opencode_go.auto_refresh,
        interval_sec: service.refresh_opencode_go.interval_sec,
      },
    },
    usage_sync: {
      auto_sync: service.usage_sync.auto_sync,
      interval_sec: service.usage_sync.interval_sec,
      backfill_pages_per_request: service.usage_sync.backfill_pages_per_request,
      max_pages_per_incremental: service.usage_sync.max_pages_per_incremental,
    },
    accounts_imported:
      fs.existsSync(db.importedFlagPath()) ||
      db.countOpencodeAccounts() > 0,
    opencode_accounts: db.listOpencodeAccounts().map(opencodeAccountDict),
  };
}

async function fetchQuotaForDashboard(): Promise<Record<string, unknown>[]> {
  const rows = db.listOpencodeAccounts(true);
  if (!rows.length) return [];
  const accounts: AccountConfig[] = rows.map((row) => ({
    name: row.name,
    workspace_id: row.workspace_id,
    auth_cookie: row.auth_cookie,
    show_rolling: row.show_rolling,
    show_weekly: row.show_weekly,
    show_monthly: row.show_monthly,
  }));
  const results = await fetchAllQuotas(accounts);
  const idByName = Object.fromEntries(rows.map((r) => [r.name, r.id]));
  for (const item of results) {
    item.account_id = idByName[String(item.name ?? '')];
  }
  db.saveQuotaSnapshots(results);
  db.autoCalibrateQuotaWeights();
  return results;
}

export type RestartSyncFn = () => void;

function safeTokenEqual(supplied: string, expected: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (origin === 'null') return true; // file:// 页面
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function createApp(opts: { onConfigUpdated?: RestartSyncFn; authToken?: string } = {}): Hono {
  const app = new Hono();
  const authToken = opts.authToken ?? '';

  app.onError((err, c) => {
    if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as Record<string, unknown>).issues)) {
      return c.json({ detail: 'Validation error', issues: (err as Record<string, unknown>).issues }, 400);
    }
    console.error('[backend] unhandled error:', err);
    return c.json({ detail: String(err instanceof Error ? err.message : err) }, 500);
  });

  // 仅允许本地渲染进程(file:// 或 http://127.0.0.1:* / http://localhost:*)
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = isLocalOrigin(origin);
    if (c.req.method === 'OPTIONS') {
      if (allowed) {
        c.header('Access-Control-Allow-Origin', origin === 'null' ? 'null' : (origin as string));
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        c.header('Access-Control-Max-Age', '600');
      }
      return c.body(null, 204);
    }
    await next();
    const res = c.res;
    if (allowed && res) {
      res.headers.set('Access-Control-Allow-Origin', origin === 'null' ? 'null' : (origin as string));
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.headers.set('Vary', 'Origin');
    }
    return res;
  });

  // 每次安装生成随机 token,所有 API 必须携带 Authorization: Bearer <token>
  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const supplied = c.req.header('authorization') ?? '';
    const token = supplied.startsWith('Bearer ') ? supplied.slice(7) : '';
    if (!authToken || !safeTokenEqual(token, authToken)) {
      return c.json({ detail: 'unauthorized' }, 401);
    }
    return next();
  });

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.get('/api/config', (c) => {
    try {
      ensureBootstrapped();
      return c.json(buildConfigResponse());
    } catch (exc) {
      return c.json({ detail: String(exc instanceof Error ? exc.message : exc) }, 500);
    }
  });

  app.put('/api/config', async (c) => {
    try {
      ensureBootstrapped();
      const body = ServiceConfigUpdate.parse(await c.req.json());
      const updates: Record<string, unknown> = {};
      if (body.refresh) updates.refresh = body.refresh;
      if (body.usage_sync) updates.usage_sync = body.usage_sync;
      if (body.opencode) updates.opencode = body.opencode;
      updateServiceConfig(updates);
      opts.onConfigUpdated?.();
      return c.json(buildConfigResponse());
    } catch (exc) {
      return c.json({ detail: String(exc instanceof Error ? exc.message : exc) }, 500);
    }
  });

  app.get('/api/accounts/opencode', (c) => {
    return c.json(db.listOpencodeAccounts().map(opencodeAccountDict));
  });

  app.post('/api/accounts/opencode', async (c) => {
    const body = OpenCodeAccountCreate.parse(await c.req.json());
    if (!body.auth_cookie.trim()) {
      return c.json({ detail: 'auth_cookie 不能为空' }, 400);
    }
    const row = db.createOpencodeAccount({
      name: body.name.trim() || 'OpenCode',
      workspace_id: (body.workspace_id || 'Default').trim() || 'Default',
      auth_cookie: body.auth_cookie.trim(),
      show_rolling: body.show_rolling,
      show_weekly: body.show_weekly,
      show_monthly: body.show_monthly,
      enabled: body.enabled,
    });
    return c.json(opencodeAccountDict(row));
  });

  app.get('/api/accounts/opencode/:accountId', (c) => {
    const row = db.getOpencodeAccount(c.req.param('accountId'));
    if (!row) return c.json({ detail: '账号不存在' }, 404);
    return c.json(opencodeAccountDict(row));
  });

  app.put('/api/accounts/opencode/:accountId', async (c) => {
    const accountId = c.req.param('accountId');
    const body = OpenCodeAccountUpdate.parse(await c.req.json());
    const fields: Record<string, unknown> = {};
    if (body.name !== undefined) fields.name = body.name.trim() || 'OpenCode';
    if (body.workspace_id !== undefined) {
      fields.workspace_id = body.workspace_id.trim() || 'Default';
      fields.resolved_workspace_id = null;
    }
    if (body.auth_cookie !== undefined) fields.auth_cookie = body.auth_cookie.trim();
    if (body.show_rolling !== undefined) fields.show_rolling = body.show_rolling;
    if (body.show_weekly !== undefined) fields.show_weekly = body.show_weekly;
    if (body.show_monthly !== undefined) fields.show_monthly = body.show_monthly;
    if (body.enabled !== undefined) fields.enabled = body.enabled;
    const row = db.updateOpencodeAccount(accountId, fields);
    if (!row) return c.json({ detail: '账号不存在' }, 404);
    return c.json(opencodeAccountDict(row));
  });

  app.delete('/api/accounts/opencode/:accountId', (c) => {
    if (!db.deleteOpencodeAccount(c.req.param('accountId'))) {
      return c.json({ detail: '账号不存在' }, 404);
    }
    return c.json({ ok: true });
  });

  app.post('/api/accounts/opencode/:accountId/test', async (c) => {
    const row = db.getOpencodeAccount(c.req.param('accountId'));
    if (!row) return c.json({ detail: '账号不存在' }, 404);
    try {
      const workspaceId = await resolveAccountWorkspaceId(
        row.workspace_id,
        row.auth_cookie,
        row.resolved_workspace_id,
      );
      db.updateOpencodeAccount(row.id, { resolved_workspace_id: workspaceId });
      return c.json({ success: true, workspace_id: workspaceId });
    } catch (exc) {
      return c.json({ success: false, error: String(exc instanceof Error ? exc.message : exc) });
    }
  });

  app.get('/api/accounts/opencode/:accountId/quota', async (c) => {
    const row = db.getOpencodeAccount(c.req.param('accountId'));
    if (!row) return c.json({ detail: '账号不存在' }, 404);
    const account: AccountConfig = {
      name: row.name,
      workspace_id: row.workspace_id,
      auth_cookie: row.auth_cookie,
      show_rolling: row.show_rolling,
      show_weekly: row.show_weekly,
      show_monthly: row.show_monthly,
    };
    const quota = await fetchQuotaForAccount(account, 0);
    const payload = { ...quotaAccountToDict(quota), account_id: row.id };
    db.saveQuotaSnapshots([payload]);
    db.autoCalibrateQuotaWeights(row.id);
    return c.json(payload);
  });

  app.get('/api/accounts/opencode/:accountId/usage', (c) => {
    const accountId = c.req.param('accountId');
    if (!db.getOpencodeAccount(accountId)) return c.json({ detail: '账号不存在' }, 404);
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') || 50), 200));
    const keyId = c.req.query('key_id') || undefined;
    const [records, total] = db.listUsageRecords(accountId, {
      offset,
      limit,
      key_id: keyId,
    });
    const sync = db.getUsageSyncState(accountId);
    return c.json({
      records: records.map(db.usageRecordToDict),
      total,
      offset,
      limit,
      key_ids: db.listUsageKeyIds(accountId),
      sync: db.usageSyncStateToDict(sync),
    });
  });

  app.get('/api/accounts/opencode/:accountId/usage/status', (c) => {
    const accountId = c.req.param('accountId');
    if (!db.getOpencodeAccount(accountId)) return c.json({ detail: '账号不存在' }, 404);
    return c.json(db.usageSyncStateToDict(db.getUsageSyncState(accountId)));
  });

  app.post('/api/accounts/opencode/:accountId/usage/sync', async (c) => {
    const row = db.getOpencodeAccount(c.req.param('accountId'));
    if (!row) return c.json({ detail: '账号不存在' }, 404);
    const pages = Math.max(1, Math.min(Number(c.req.query('pages') || 30), 100));
    try {
      const result = await syncUsage(row, pages);
      return c.json(syncResultToDict(result));
    } catch (exc) {
      return c.json({ detail: String(exc instanceof Error ? exc.message : exc) }, 502);
    }
  });

  app.post('/api/accounts/opencode/:accountId/usage/backfill', async (c) => {
    const row = db.getOpencodeAccount(c.req.param('accountId'));
    if (!row) return c.json({ detail: '账号不存在' }, 404);
    const mode = c.req.query('mode') === 'days' || c.req.query('mode') === 'until'
      ? c.req.query('mode') as 'days' | 'until'
      : 'all';
    const days = Math.max(1, Math.min(Number(c.req.query('days') || 30), 3650));
    const until = c.req.query('until');
    if (mode === 'until' && !/^\d{4}-\d{2}-\d{2}$/.test(until || '')) {
      return c.json({ detail: 'until must use YYYY-MM-DD' }, 400);
    }
    try {
      const result = await backfillUsage(row, 1000, { mode, days, until });
      return c.json(syncResultToDict(result));
    } catch (exc) {
      return c.json({ detail: String(exc instanceof Error ? exc.message : exc) }, 502);
    }
  });

  app.get('/api/accounts/opencode/:accountId/usage/progress', (c) => {
    const accountId = c.req.param('accountId');
    if (!db.getOpencodeAccount(accountId)) {
      return c.json({ status: 'idle', current: 0, total: 0, inserted: 0 });
    }
    return c.json(syncProgress.get(accountId));
  });

  app.get('/api/quota', async (c) => {
    try {
      loadServiceConfig();
    } catch (exc) {
      return c.json({ detail: String(exc instanceof Error ? exc.message : exc) }, 500);
    }
    const rows = db.listOpencodeAccounts(true);
    if (!rows.length) return c.json([]);
    const accounts: AccountConfig[] = rows.map((row) => ({
      name: row.name,
      workspace_id: row.workspace_id,
      auth_cookie: row.auth_cookie,
      show_rolling: row.show_rolling,
      show_weekly: row.show_weekly,
      show_monthly: row.show_monthly,
    }));
    const results = await fetchAllQuotas(accounts);
    const idByName = Object.fromEntries(rows.map((r) => [r.name, r.id]));
    for (const item of results) {
      item.account_id = idByName[String(item.name ?? '')];
    }
    db.saveQuotaSnapshots(results);
    db.autoCalibrateQuotaWeights();
    return c.json(results);
  });

  app.get('/api/quota/snapshots', (c) => {
    return c.json({ snapshots: db.listQuotaSnapshots({
      account_id: c.req.query('account_id') || undefined,
      window_label: c.req.query('window_label') || undefined,
      limit: Number(c.req.query('limit') || 500),
    }) });
  });

  app.get('/api/quota/intelligence', (c) => c.json({
    windows: analyzeQuotaWindows(db.listQuotaSnapshots({
      account_id: c.req.query('account_id') || undefined,
      limit: 5000,
    })),
  }));

  app.get('/api/quota/reconciliation', (c) => c.json({
    events: reconcileQuotaWindows(db.listQuotaReconciliationInputs(
      c.req.query('account_id') || undefined,
    )),
  }));

  app.get('/api/quota/weights', (c) => c.json({ rules: db.listQuotaWeightRules() }));
  app.post('/api/quota/weights', async (c) => {
    const body = QuotaWeightRuleCreate.parse(await c.req.json());
    return c.json(db.createQuotaWeightRule(body), 201);
  });
  app.post('/api/quota/weights/calibrate', (c) => c.json({
    created: db.autoCalibrateQuotaWeights(c.req.query('account_id') || undefined),
  }));
  app.get('/api/quota/units', (c) => c.json(db.opencodeQuotaUnitStats(
    c.req.query('period') || '30d', c.req.query('account_id') || undefined,
  )));

  app.get('/api/dashboard', async (c) => {
    const period = c.req.query('period') || '30d';
    if (!/^(5h|today|all|\d+d)$/.test(period)) {
      return c.json({ detail: 'invalid period' }, 400);
    }
    // Dashboard quota and overview previously fetched the same OpenCode quota
    // endpoint twice. Fetch once and pass the result into the aggregator.
    const quota = await fetchQuotaForDashboard();
    const overview = await buildOverview({ opencodeQuotas: quota });
    const [usageRecords, usageTotal] = db.listAllUsageRecords({ offset: 0, limit: 10 });
    const modelTokens = db.opencodeModelTokenStats(period);
    const dataHealth = db.listUsageDataHealth();
    const quotaIntelligence = analyzeQuotaWindows(db.listQuotaSnapshots({ limit: 5000 }));
    const quotaReconciliation = reconcileQuotaWindows(db.listQuotaReconciliationInputs());
    const quotaUnits = db.opencodeQuotaUnitStats(period);
    return c.json({
      overview,
      quota,
      recent_usage: {
        records: usageRecords.map(db.usageRecordWithAccountToDict),
        total: usageTotal,
      },
      model_tokens: modelTokens,
      data_health: dataHealth,
      quota_intelligence: quotaIntelligence,
      quota_reconciliation: quotaReconciliation.slice(0, 50),
      quota_units: quotaUnits,
      period,
    });
  });

  app.get('/api/analytics/overview', async (c) => {
    try {
      return c.json(await buildOverview());
    } catch (exc) {
      return c.json({ detail: String(exc instanceof Error ? exc.message : exc) }, 500);
    }
  });

  app.get('/api/health/data', (c) => c.json({ accounts: db.listUsageDataHealth() }));

  app.get('/api/analytics/opencode/daily', (c) => {
    const days = Math.max(1, Math.min(Number(c.req.query('days') || 30), 365));
    const accountId = c.req.query('account_id') || undefined;
    return c.json({ days, stats: db.opencodeDailyStats(days, accountId) });
  });

  app.get('/api/analytics/opencode/hourly', (c) => {
    const accountId = c.req.query('account_id') || undefined;
    return c.json({ hours: 24, stats: db.opencodeHourlyStats(accountId) });
  });

  app.get('/api/analytics/opencode/daily/models', (c) => {
    const days = Math.max(1, Math.min(Number(c.req.query('days') || 30), 365));
    const accountId = c.req.query('account_id') || undefined;
    return c.json({ days, stats: db.opencodeDailyModelStats(days, accountId) });
  });

  app.get('/api/analytics/opencode/model-tokens', (c) => {
    const days = Math.max(1, Math.min(Number(c.req.query('days') || 30), 365));
    const accountId = c.req.query('account_id') || undefined;
    const period = c.req.query('period');
    if (period && /^(5h|today|all|\d+d)$/.test(period)) {
      return c.json({ days, stats: db.opencodeModelTokenStats(period, accountId) });
    }
    return c.json({ days, stats: db.opencodeModelTokenStats(`${days}d`, accountId) });
  });

  app.get('/api/usage/all', (c) => {
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') || 50), 500));
    const accountId = c.req.query('account_id') || undefined;
    const [records, total] = db.listAllUsageRecords({
      offset,
      limit: Math.min(limit, 200),
      account_id: accountId,
    });
    const accounts = db.listOpencodeAccounts();
    return c.json({
      records: records.map(db.usageRecordWithAccountToDict),
      total,
      offset,
      limit,
      accounts: accounts.map((row) => ({ id: row.id, name: row.name })),
    });
  });

  app.get('/api/usage/sessions', (c) => {
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') || 50), 200));
    const accountId = c.req.query('account_id') || undefined;
    const [sessions, total] = db.listUsageSessions({ offset, limit, account_id: accountId });
    return c.json({ sessions, total, offset, limit });
  });

  app.get('/api/usage/session-records', (c) => {
    const accountId = c.req.query('account_id');
    if (!accountId) return c.json({ detail: 'account_id is required' }, 400);
    const sessionId = c.req.query('unassigned') === 'true'
      ? null
      : c.req.query('session_id') || null;
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') || 100), 200));
    const [records, total] = db.listSessionUsageRecords({
      account_id: accountId, session_id: sessionId, offset, limit,
    });
    return c.json({ records: records.map(db.usageRecordWithAccountToDict), total, offset, limit });
  });

  app.put('/api/usage/session-context', async (c) => {
    const body = SessionContextUpdate.parse(await c.req.json());
    if (!db.getOpencodeAccount(body.account_id)) return c.json({ detail: 'account not found' }, 404);
    return c.json(db.upsertSessionContext(body));
  });

  app.get('/api/analytics/opencode/projects', (c) => c.json({
    projects: db.listProjectUsageStats(c.req.query('account_id') || undefined),
  }));

  app.get('/api/data/export.csv', (c) => {
    const escape = (value: unknown) => {
      const text = value == null ? '' : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const columns = [
      'created_at', 'account_name', 'session_id', 'model', 'provider', 'input_tokens',
      'output_tokens', 'reasoning_tokens', 'cache_read_tokens', 'cache_write_5m_tokens',
      'cache_write_1h_tokens', 'cost_usd', 'key_id', 'plan',
    ] as const;
    const rows = db.listUsageRecordsForExport();
    const csv = [columns.join(','), ...rows.map((row) =>
      columns.map((column) => escape(row[column])).join(','))].join('\r\n');
    return new Response(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="opencodegoboard-usage.csv"',
      },
    });
  });

  app.get('/api/data/backup', (c) => {
    const backup = db.createDatabaseBackup();
    return new Response(backup, {
      headers: {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': 'attachment; filename="opencodegoboard-backup.db"',
      },
    });
  });

  app.post('/api/data/restore', async (c) => {
    const contents = Buffer.from(await c.req.arrayBuffer());
    if (!contents.length || contents.length > 1024 * 1024 * 1024) {
      return c.json({ detail: 'invalid backup size' }, 400);
    }
    try {
      const result = db.restoreDatabaseBackup(contents);
      return c.json({ ok: true, schema_version: result.schemaVersion });
    } catch (error) {
      return c.json({ detail: String(error instanceof Error ? error.message : error) }, 400);
    }
  });

  app.post('/api/config/reset', async (c) => {
    try {
      ensureBootstrapped();
      saveSettingsPayload({});
      opts.onConfigUpdated?.();
      return c.json(buildConfigResponse());
    } catch (exc) {
      return c.json({ detail: String(exc instanceof Error ? exc.message : exc) }, 500);
    }
  });

  return app;
}
