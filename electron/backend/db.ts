import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { safeStorage } from 'electron';
import { dataDir } from './config';

export interface OpenCodeAccountRow {
  id: string;
  name: string;
  workspace_id: string;
  resolved_workspace_id: string | null;
  auth_cookie: string;
  show_rolling: boolean;
  show_weekly: boolean;
  show_monthly: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsageRecordRow {
  usg_id: string;
  account_id: string;
  workspace_id: string;
  created_at: string;
  model: string;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cost_raw: number;
  cost_usd: number;
  key_id: string | null;
  session_id: string | null;
  project_path: string | null;
  session_title: string | null;
  plan: string | null;
  synced_at: string;
}

export interface UsageRecordWithAccount extends UsageRecordRow {
  account_name: string;
}

export interface UsageSessionRow {
  account_id: string;
  account_name: string;
  session_id: string | null;
  project_name: string | null;
  project_path: string | null;
  session_title: string | null;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  first_at: string;
  last_at: string;
}

export interface UsageSyncStateRow {
  account_id: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_success_at: string | null;
  last_failed_page: number | null;
  last_parse_error_count: number;
  last_inserted_count: number;
  deepest_page_fetched: number;
  total_records: number;
  oldest_record_at: string | null;
  newest_record_at: string | null;
}

let _db: Database.Database | null = null;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function dbPath(): string {
  return path.join(dataDir(), '68backend.db');
}

export function importedFlagPath(): string {
  return path.join(dataDir(), '.imported');
}

// 敏感凭据(auth cookie / session cookie)用系统级加密(Windows 为 DPAPI)落库,
// 读取时透明解密;未加密的旧数据或迁移后的数据保持原样可用。
function encryptSecret(plain: string): string {
  if (!plain) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(plain).toString('base64')}`;
    }
  } catch {
    // fall through to plaintext
  }
  return plain;
}

function decryptSecret(stored: string): string {
  if (!stored.startsWith('enc:')) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  } catch {
    return stored;
  }
}

function mapOpenCode(row: Record<string, unknown>): OpenCodeAccountRow {
  return {
    id: String(row.id),
    name: String(row.name),
    workspace_id: String(row.workspace_id),
    resolved_workspace_id: row.resolved_workspace_id != null ? String(row.resolved_workspace_id) : null,
    auth_cookie: decryptSecret(String(row.auth_cookie)),
    show_rolling: Boolean(row.show_rolling),
    show_weekly: Boolean(row.show_weekly),
    show_monthly: Boolean(row.show_monthly),
    enabled: Boolean(row.enabled),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapUsage(row: Record<string, unknown>): UsageRecordRow {
  return {
    usg_id: String(row.usg_id),
    account_id: String(row.account_id),
    workspace_id: String(row.workspace_id),
    created_at: String(row.created_at),
    model: String(row.model),
    provider: row.provider != null ? String(row.provider) : null,
    input_tokens: Number(row.input_tokens),
    output_tokens: Number(row.output_tokens),
    reasoning_tokens: Number(row.reasoning_tokens || 0),
    cache_read_tokens: Number(row.cache_read_tokens || 0),
    cache_write_5m_tokens: Number(row.cache_write_5m_tokens || 0),
    cache_write_1h_tokens: Number(row.cache_write_1h_tokens || 0),
    cost_raw: Number(row.cost_raw),
    cost_usd: Number(row.cost_usd),
    key_id: row.key_id != null ? String(row.key_id) : null,
    session_id: row.session_id != null ? String(row.session_id) : null,
    project_path: row.project_path != null ? String(row.project_path) : null,
    session_title: row.session_title != null ? String(row.session_title) : null,
    plan: row.plan != null ? String(row.plan) : null,
    synced_at: String(row.synced_at),
  };
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const p = dbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  _db = new Database(p);
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

interface DbMigration {
  version: number;
  name: string;
  up: (conn: Database.Database) => void;
}

export const CURRENT_SCHEMA_VERSION = 7;

const MIGRATIONS: DbMigration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (conn) => conn.exec(`
    CREATE TABLE IF NOT EXISTS opencode_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'Default',
      resolved_workspace_id TEXT,
      auth_cookie TEXT NOT NULL,
      show_rolling INTEGER NOT NULL DEFAULT 1,
      show_weekly INTEGER NOT NULL DEFAULT 1,
      show_monthly INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ollama_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      session_cookie TEXT NOT NULL,
      show_session INTEGER NOT NULL DEFAULT 1,
      show_weekly INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      usg_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES opencode_accounts(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
      cost_raw INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      key_id TEXT,
      plan TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_account_time
      ON usage_records(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_account_key
      ON usage_records(account_id, key_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS usage_sync_state (
      account_id TEXT PRIMARY KEY REFERENCES opencode_accounts(id) ON DELETE CASCADE,
      last_sync_at TEXT,
      last_sync_status TEXT,
      last_sync_error TEXT,
      last_inserted_count INTEGER NOT NULL DEFAULT 0,
      deepest_page_fetched INTEGER NOT NULL DEFAULT -1,
      total_records INTEGER NOT NULL DEFAULT 0,
      oldest_record_at TEXT,
      newest_record_at TEXT
    );

    CREATE TABLE IF NOT EXISTS service_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `),
  },
  {
    version: 2,
    name: 'cache token columns and cost correction',
    up: (conn) => {
      const columns = new Set(
        (conn.pragma('table_info(usage_records)') as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
      for (const column of [
        'cache_read_tokens',
        'cache_write_5m_tokens',
        'cache_write_1h_tokens',
      ]) {
        if (!columns.has(column)) {
          conn.exec(
            `ALTER TABLE usage_records ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`,
          );
        }
      }

      // 旧版本把 1e-8 美元误按 1e-9 换算，按原始值校正。
      conn.exec(`UPDATE usage_records
     SET cost_usd = cost_raw / 100000000.0
     WHERE ABS(cost_usd - cost_raw / 100000000.0) > 0.0000001`);
    },
  },
  {
    version: 3,
    name: 'usage data health fields',
    up: (conn) => {
      const columns = new Set(
        (conn.pragma('table_info(usage_sync_state)') as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
      if (!columns.has('last_success_at')) {
        conn.exec('ALTER TABLE usage_sync_state ADD COLUMN last_success_at TEXT');
      }
      if (!columns.has('last_failed_page')) {
        conn.exec('ALTER TABLE usage_sync_state ADD COLUMN last_failed_page INTEGER');
      }
      if (!columns.has('last_parse_error_count')) {
        conn.exec(
          'ALTER TABLE usage_sync_state ADD COLUMN last_parse_error_count INTEGER NOT NULL DEFAULT 0',
        );
      }
      conn.exec(`UPDATE usage_sync_state
        SET last_success_at = last_sync_at
        WHERE last_success_at IS NULL AND last_sync_status = 'ok'`);
    },
  },
  {
    version: 4,
    name: 'reasoning tokens and session attribution',
    up: (conn) => {
      const columns = new Set(
        (conn.pragma('table_info(usage_records)') as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
      if (!columns.has('reasoning_tokens')) {
        conn.exec(
          'ALTER TABLE usage_records ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0',
        );
      }
      if (!columns.has('session_id')) {
        conn.exec('ALTER TABLE usage_records ADD COLUMN session_id TEXT');
      }
      conn.exec(`CREATE INDEX IF NOT EXISTS idx_usage_session_time
        ON usage_records(account_id, session_id, created_at DESC)`);
    },
  },
  {
    version: 5,
    name: 'official quota window snapshots',
    up: (conn) => conn.exec(`
      CREATE TABLE IF NOT EXISTS quota_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES opencode_accounts(id) ON DELETE CASCADE,
        window_label TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        used REAL NOT NULL,
        remaining REAL NOT NULL,
        total REAL NOT NULL,
        reset_at TEXT NOT NULL,
        reset_in_sec INTEGER NOT NULL,
        UNIQUE(account_id, window_label, captured_at)
      );
      CREATE INDEX IF NOT EXISTS idx_quota_snapshot_window_time
        ON quota_snapshots(account_id, window_label, captured_at DESC);
    `),
  },
  {
    version: 6,
    name: 'versioned quota unit weight rules',
    up: (conn) => conn.exec(`
      CREATE TABLE IF NOT EXISTS quota_weight_rules (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES opencode_accounts(id) ON DELETE CASCADE,
        plan TEXT,
        model_pattern TEXT NOT NULL DEFAULT '*',
        weight REAL NOT NULL CHECK(weight > 0),
        effective_from TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        sample_count INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quota_weight_effective
        ON quota_weight_rules(account_id, plan, effective_from DESC);
      INSERT OR IGNORE INTO quota_weight_rules (
        id, account_id, plan, model_pattern, weight, effective_from, source, created_at
      ) VALUES ('default', NULL, NULL, '*', 1, '1970-01-01T00:00:00Z', 'default', '1970-01-01T00:00:00Z');
    `),
  },
  {
    version: 7,
    name: 'session project context',
    up: (conn) => {
      const columns = new Set((conn.pragma('table_info(usage_records)') as Array<{ name: string }>).map((column) => column.name));
      if (!columns.has('project_path')) conn.exec('ALTER TABLE usage_records ADD COLUMN project_path TEXT');
      if (!columns.has('session_title')) conn.exec('ALTER TABLE usage_records ADD COLUMN session_title TEXT');
      conn.exec(`
        CREATE TABLE IF NOT EXISTS session_contexts (
          account_id TEXT NOT NULL REFERENCES opencode_accounts(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          project_name TEXT,
          project_path TEXT,
          title TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          updated_at TEXT NOT NULL,
          PRIMARY KEY(account_id, session_id)
        );
      `);
    },
  },
];

export function getSchemaVersion(conn: Database.Database = getDb()): number {
  return Number(conn.pragma('user_version', { simple: true }) || 0);
}

export function initDb(): void {
  const conn = getDb();
  const installedVersion = getSchemaVersion(conn);
  if (installedVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `数据库版本 ${installedVersion} 高于应用支持的 ${CURRENT_SCHEMA_VERSION}，请升级应用`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= installedVersion) continue;
    const migrate = conn.transaction(() => {
      migration.up(conn);
      conn.pragma(`user_version = ${migration.version}`);
    });
    try {
      migrate();
    } catch (error) {
      throw new Error(
        `数据库迁移 v${migration.version} (${migration.name}) 失败: ${String(
          error instanceof Error ? error.message : error,
        )}`,
      );
    }
  }
}

export function usageRecordToDict(r: UsageRecordRow): Record<string, unknown> {
  const cacheWriteTokens = r.cache_write_5m_tokens + r.cache_write_1h_tokens;
  return {
    usg_id: r.usg_id,
    account_id: r.account_id,
    created_at: r.created_at,
    model: r.model,
    provider: r.provider,
    input_tokens: r.input_tokens + r.cache_read_tokens + cacheWriteTokens,
    output_tokens: r.output_tokens,
    reasoning_tokens: r.reasoning_tokens,
    uncached_input_tokens: r.input_tokens,
    cache_read_tokens: r.cache_read_tokens,
    cache_write_tokens: cacheWriteTokens,
    cost_usd: r.cost_usd,
    key_id: r.key_id,
    session_id: r.session_id,
    project_path: r.project_path,
    session_title: r.session_title,
    plan: r.plan,
  };
}

export function usageRecordWithAccountToDict(r: UsageRecordWithAccount): Record<string, unknown> {
  return { ...usageRecordToDict(r), account_name: r.account_name };
}

export function usageSyncStateToDict(s: UsageSyncStateRow): Record<string, unknown> {
  return {
    last_sync_at: s.last_sync_at,
    last_sync_status: s.last_sync_status,
    last_sync_error: s.last_sync_error,
    last_success_at: s.last_success_at,
    last_failed_page: s.last_failed_page,
    last_parse_error_count: s.last_parse_error_count,
    healthy: s.last_sync_status === 'ok' && s.last_parse_error_count === 0,
    last_inserted_count: s.last_inserted_count,
    deepest_page_fetched: s.deepest_page_fetched,
    total_records: s.total_records,
    oldest_record_at: s.oldest_record_at,
    newest_record_at: s.newest_record_at,
  };
}

export function listOpencodeAccounts(enabledOnly = false): OpenCodeAccountRow[] {
  const conn = getDb();
  let sql = 'SELECT * FROM opencode_accounts';
  if (enabledOnly) sql += ' WHERE enabled = 1';
  sql += ' ORDER BY created_at ASC';
  return conn.prepare(sql).all().map((r) => mapOpenCode(r as Record<string, unknown>));
}

export function getOpencodeAccount(accountId: string): OpenCodeAccountRow | null {
  const row = getDb().prepare('SELECT * FROM opencode_accounts WHERE id = ?').get(accountId);
  return row ? mapOpenCode(row as Record<string, unknown>) : null;
}

export function createOpencodeAccount(opts: {
  name: string;
  workspace_id: string;
  auth_cookie: string;
  show_rolling?: boolean;
  show_weekly?: boolean;
  show_monthly?: boolean;
  enabled?: boolean;
}): OpenCodeAccountRow {
  const accountId = randomUUID();
  const now = nowIso();
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO opencode_accounts (
        id, name, workspace_id, resolved_workspace_id, auth_cookie,
        show_rolling, show_weekly, show_monthly, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
      opts.name,
      opts.workspace_id,
      encryptSecret(opts.auth_cookie),
      opts.show_rolling !== false ? 1 : 0,
      opts.show_weekly !== false ? 1 : 0,
      opts.show_monthly !== false ? 1 : 0,
      opts.enabled !== false ? 1 : 0,
      now,
      now,
    );
  conn.prepare('INSERT INTO usage_sync_state (account_id) VALUES (?)').run(accountId);
  const account = getOpencodeAccount(accountId);
  if (!account) throw new Error('failed to create account');
  return account;
}

export function updateOpencodeAccount(
  accountId: string,
  fields: Record<string, unknown>,
): OpenCodeAccountRow | null {
  const allowed = new Set([
    'name',
    'workspace_id',
    'resolved_workspace_id',
    'auth_cookie',
    'show_rolling',
    'show_weekly',
    'show_monthly',
    'enabled',
  ]);
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key) || value === undefined) continue;
    let v = value;
    if (['show_rolling', 'show_weekly', 'show_monthly', 'enabled'].includes(key)) {
      v = value ? 1 : 0;
    }
    if (key === 'auth_cookie') {
      v = encryptSecret(String(v));
    }
    // allow null for resolved_workspace_id
    if (value === null && key !== 'resolved_workspace_id') continue;
    updates.push(`${key} = ?`);
    values.push(v);
  }
  if (updates.length === 0) return getOpencodeAccount(accountId);
  updates.push('updated_at = ?');
  values.push(nowIso());
  values.push(accountId);
  const result = getDb()
    .prepare(`UPDATE opencode_accounts SET ${updates.join(', ')} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) return null;
  return getOpencodeAccount(accountId);
}

export function deleteOpencodeAccount(accountId: string): boolean {
  const result = getDb().prepare('DELETE FROM opencode_accounts WHERE id = ?').run(accountId);
  return result.changes > 0;
}

export function insertUsageRecordsIgnore(
  accountId: string,
  workspaceId: string,
  records: Record<string, unknown>[],
): number {
  if (!records.length) return 0;
  const syncedAt = nowIso();
  const stmt = getDb().prepare(
    `INSERT INTO usage_records (
      usg_id, account_id, workspace_id, created_at, model, provider,
      input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens,
      cache_write_1h_tokens, cost_raw, cost_usd, key_id, session_id, project_path,
      session_title, plan, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(usg_id) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      reasoning_tokens = excluded.reasoning_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_write_5m_tokens = excluded.cache_write_5m_tokens,
      cache_write_1h_tokens = excluded.cache_write_1h_tokens,
      cost_raw = excluded.cost_raw,
      cost_usd = excluded.cost_usd,
      session_id = excluded.session_id,
      project_path = COALESCE(NULLIF(excluded.project_path, ''), usage_records.project_path),
      session_title = COALESCE(NULLIF(excluded.session_title, ''), usage_records.session_title),
      synced_at = excluded.synced_at`,
  );
  const existingStmt = getDb().prepare('SELECT 1 FROM usage_records WHERE usg_id = ?');
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  let inserted = 0;
  const tx = getDb().transaction(() => {
    for (const rec of records) {
      const existed = existingStmt.get(rec.usg_id) != null;
      const result = stmt.run(
        rec.usg_id,
        accountId,
        workspaceId,
        rec.created_at,
        rec.model,
        rec.provider ?? null,
        num(rec.input_tokens),
        num(rec.output_tokens),
        num(rec.reasoning_tokens),
        num(rec.cache_read_tokens),
        num(rec.cache_write_5m_tokens),
        num(rec.cache_write_1h_tokens),
        num(rec.cost_raw),
        num(rec.cost_usd),
        rec.key_id ?? null,
        rec.session_id ?? null,
        rec.project_path ?? null,
        rec.session_title ?? null,
        rec.plan ?? null,
        syncedAt,
      );
      if (!existed) inserted += result.changes;
    }
  });
  tx();
  return inserted;
}

export function listUsageRecords(
  accountId: string,
  opts: { offset?: number; limit?: number; key_id?: string | null } = {},
): [UsageRecordRow[], number] {
  let offset = Math.max(0, opts.offset ?? 0);
  let limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  let where = 'WHERE account_id = ?';
  const params: unknown[] = [accountId];
  if (opts.key_id) {
    where += ' AND key_id = ?';
    params.push(opts.key_id);
  }
  const conn = getDb();
  const total = Number(
    (conn.prepare(`SELECT COUNT(*) AS c FROM usage_records ${where}`).get(...params) as { c: number })
      .c,
  );
  const rows = conn
    .prepare(
      `SELECT * FROM usage_records ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return [rows.map((r) => mapUsage(r as Record<string, unknown>)), total];
}

export function listUsageKeyIds(accountId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT key_id FROM usage_records
       WHERE account_id = ? AND key_id IS NOT NULL AND key_id != ''
       ORDER BY key_id`,
    )
    .all(accountId) as { key_id: string }[];
  return rows.map((r) => r.key_id);
}

export function listAllUsageRecords(opts: {
  offset?: number;
  limit?: number;
  account_id?: string | null;
} = {}): [UsageRecordWithAccount[], number] {
  let offset = Math.max(0, opts.offset ?? 0);
  let limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  let where = '';
  const params: unknown[] = [];
  if (opts.account_id) {
    where = 'WHERE ur.account_id = ?';
    params.push(opts.account_id);
  }
  const conn = getDb();
  const total = Number(
    (
      conn
        .prepare(
          `SELECT COUNT(*) AS c FROM usage_records ur
           JOIN opencode_accounts oa ON oa.id = ur.account_id
           ${where}`,
        )
        .get(...params) as { c: number }
    ).c,
  );
  const rows = conn
    .prepare(
      `SELECT ur.*, oa.name AS account_name
       FROM usage_records ur
       JOIN opencode_accounts oa ON oa.id = ur.account_id
       ${where}
       ORDER BY ur.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const records = rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ...mapUsage(row),
      account_name: String(row.account_name),
    };
  });
  return [records, total];
}

export function listUsageSessions(opts: {
  offset?: number;
  limit?: number;
  account_id?: string | null;
} = {}): [UsageSessionRow[], number] {
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const where = opts.account_id ? 'WHERE ur.account_id = ?' : '';
  const params: unknown[] = opts.account_id ? [opts.account_id] : [];
  const baseFrom = `
    FROM usage_records ur
    JOIN opencode_accounts oa ON oa.id = ur.account_id
    ${where}`;
  const grouping = `${baseFrom} GROUP BY ur.account_id, oa.name, ur.session_id`;
  const conn = getDb();
  const total = Number(
    (conn.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 ${grouping})`).get(...params) as { c: number }).c,
  );
  const rows = conn.prepare(`
    SELECT ur.account_id, oa.name AS account_name, ur.session_id,
      COALESCE(sc.project_name, MAX(NULLIF(ur.project_path, ''))) AS project_name,
      COALESCE(sc.project_path, MAX(NULLIF(ur.project_path, ''))) AS project_path,
      COALESCE(sc.title, MAX(NULLIF(ur.session_title, ''))) AS session_title,
      COUNT(*) AS request_count,
      SUM(ur.input_tokens) AS total_input_tokens,
      SUM(ur.output_tokens) AS total_output_tokens,
      SUM(ur.reasoning_tokens) AS total_reasoning_tokens,
      SUM(ur.cache_read_tokens) AS total_cache_read_tokens,
      SUM(ur.cost_usd) AS total_cost_usd,
      MIN(ur.created_at) AS first_at,
      MAX(ur.created_at) AS last_at
    FROM usage_records ur
    JOIN opencode_accounts oa ON oa.id = ur.account_id
    LEFT JOIN session_contexts sc ON sc.account_id = ur.account_id AND sc.session_id = ur.session_id
    ${where}
    GROUP BY ur.account_id, oa.name, ur.session_id, sc.project_name, sc.project_path, sc.title
    ORDER BY last_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<Record<string, unknown>>;
  return [rows.map((row) => ({
    account_id: String(row.account_id),
    account_name: String(row.account_name),
    session_id: row.session_id != null && String(row.session_id) !== '' ? String(row.session_id) : null,
    project_name: row.project_name != null ? String(row.project_name) : null,
    project_path: row.project_path != null ? String(row.project_path) : null,
    session_title: row.session_title != null ? String(row.session_title) : null,
    request_count: Number(row.request_count),
    total_input_tokens: Number(row.total_input_tokens),
    total_output_tokens: Number(row.total_output_tokens),
    total_reasoning_tokens: Number(row.total_reasoning_tokens),
    total_cache_read_tokens: Number(row.total_cache_read_tokens),
    total_cost_usd: Number(row.total_cost_usd),
    first_at: String(row.first_at),
    last_at: String(row.last_at),
  })), total];
}

export function listSessionUsageRecords(opts: {
  account_id: string;
  session_id: string | null;
  offset?: number;
  limit?: number;
}): [UsageRecordWithAccount[], number] {
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 200));
  const sessionWhere = opts.session_id == null
    ? "(ur.session_id IS NULL OR ur.session_id = '')"
    : 'ur.session_id = ?';
  const params: unknown[] = opts.session_id == null
    ? [opts.account_id]
    : [opts.account_id, opts.session_id];
  const where = `WHERE ur.account_id = ? AND ${sessionWhere}`;
  const conn = getDb();
  const total = Number((conn.prepare(`
    SELECT COUNT(*) AS c FROM usage_records ur ${where}
  `).get(...params) as { c: number }).c);
  const rows = conn.prepare(`
    SELECT ur.*, oa.name AS account_name
    FROM usage_records ur
    JOIN opencode_accounts oa ON oa.id = ur.account_id
    ${where}
    ORDER BY ur.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<Record<string, unknown>>;
  return [rows.map((row) => ({ ...mapUsage(row), account_name: String(row.account_name) })), total];
}

export function upsertSessionContext(input: {
  account_id: string; session_id: string; project_name?: string | null;
  project_path?: string | null; title?: string | null;
}): Record<string, unknown> {
  getDb().prepare(`
    INSERT INTO session_contexts (account_id, session_id, project_name, project_path, title, source, updated_at)
    VALUES (?, ?, ?, ?, ?, 'manual', ?)
    ON CONFLICT(account_id, session_id) DO UPDATE SET
      project_name = excluded.project_name, project_path = excluded.project_path,
      title = excluded.title, source = 'manual', updated_at = excluded.updated_at
  `).run(input.account_id, input.session_id, input.project_name || null,
    input.project_path || null, input.title || null, nowIso());
  return getDb().prepare('SELECT * FROM session_contexts WHERE account_id = ? AND session_id = ?')
    .get(input.account_id, input.session_id) as Record<string, unknown>;
}

export function listProjectUsageStats(accountId?: string): Array<Record<string, unknown>> {
  const rows = getDb().prepare(`
    SELECT COALESCE(NULLIF(sc.project_name, ''), NULLIF(sc.project_path, ''), NULLIF(ur.project_path, ''), 'Unassigned') AS project_name,
      COALESCE(NULLIF(sc.project_path, ''), NULLIF(ur.project_path, '')) AS project_path,
      ur.model, COUNT(*) AS request_count,
      COUNT(DISTINCT NULLIF(ur.session_id, '')) AS session_count,
      SUM(ur.cost_usd) AS total_cost_usd,
      SUM(ur.input_tokens + ur.output_tokens + ur.reasoning_tokens + ur.cache_read_tokens + ur.cache_write_5m_tokens + ur.cache_write_1h_tokens) AS total_tokens,
      SUM(ur.cache_read_tokens) AS cache_read_tokens,
      SUM(ur.input_tokens + ur.cache_read_tokens + ur.cache_write_5m_tokens + ur.cache_write_1h_tokens) AS total_input_tokens
    FROM usage_records ur
    LEFT JOIN session_contexts sc ON sc.account_id = ur.account_id AND sc.session_id = ur.session_id
    ${accountId ? 'WHERE ur.account_id = ?' : ''}
    GROUP BY 1, 2, ur.model
    ORDER BY total_cost_usd DESC
  `).all(...(accountId ? [accountId] : [])) as Array<Record<string, unknown>>;
  const projects = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = `${row.project_name}\u0000${row.project_path || ''}`;
    const project = projects.get(key) ?? {
      project_name: String(row.project_name), project_path: row.project_path != null ? String(row.project_path) : null,
      request_count: 0, session_count: 0, total_cost_usd: 0, total_tokens: 0,
      cache_read_tokens: 0, total_input_tokens: 0, models: [],
    };
    for (const field of ['request_count', 'session_count', 'total_cost_usd', 'total_tokens', 'cache_read_tokens', 'total_input_tokens']) {
      project[field] = Number(project[field]) + Number(row[field] || 0);
    }
    (project.models as Array<Record<string, unknown>>).push({
      model: String(row.model), request_count: Number(row.request_count),
      total_tokens: Number(row.total_tokens), total_cost_usd: Number(row.total_cost_usd),
    });
    projects.set(key, project);
  }
  return [...projects.values()].map((project) => ({
    ...project, total_cost_usd: Math.round(Number(project.total_cost_usd) * 1e6) / 1e6,
    cache_hit_rate: Number(project.total_input_tokens) > 0
      ? Math.round(Number(project.cache_read_tokens) / Number(project.total_input_tokens) * 1000) / 10 : 0,
  })).sort((a, b) => Number(b.total_cost_usd) - Number(a.total_cost_usd));
}

export function opencodeDailyStats(days = 30, accountId?: string | null): Record<string, unknown>[] {
  days = Math.max(1, Math.min(days, 365));
  let where = "WHERE substr(datetime(created_at, 'localtime'), 1, 10) >= date('now', 'localtime', ?)";
  const params: unknown[] = [`-${days} days`];
  if (accountId) {
    where += ' AND account_id = ?';
    params.push(accountId);
  }
  const rows = getDb()
    .prepare(
      `SELECT substr(datetime(created_at, 'localtime'), 1, 10) AS date,
              SUM(cost_usd) AS total_cost_usd,
               COUNT(*) AS request_count,
               SUM(input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens) AS total_input_tokens,
               SUM(input_tokens) AS uncached_input_tokens,
               SUM(cache_read_tokens) AS cache_hit_tokens,
               SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write_tokens,
               SUM(output_tokens) AS total_output_tokens,
               SUM(reasoning_tokens) AS total_reasoning_tokens
       FROM usage_records
       ${where}
       GROUP BY substr(datetime(created_at, 'localtime'), 1, 10)
       ORDER BY date DESC`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => ({
    date: r.date,
    total_cost_usd: Math.round(Number(r.total_cost_usd || 0) * 1e6) / 1e6,
     request_count: Number(r.request_count),
     total_input_tokens: Number(r.total_input_tokens || 0),
     uncached_input_tokens: Number(r.uncached_input_tokens || 0),
     cache_hit_tokens: Number(r.cache_hit_tokens || 0),
     cache_write_tokens: Number(r.cache_write_tokens || 0),
     total_output_tokens: Number(r.total_output_tokens || 0),
     total_reasoning_tokens: Number(r.total_reasoning_tokens || 0),
  }));
}

export function opencodeHourlyStats(accountId?: string | null): Record<string, unknown>[] {
  const accountFilter = accountId ? 'WHERE account_id = ?' : '';
  const params: unknown[] = accountId ? [accountId] : [];
  const rows = getDb().prepare(`
    WITH RECURSIVE hours(hour, n) AS (
      SELECT strftime('%Y-%m-%d %H:00', 'now', 'localtime', '-23 hours'), 0
      UNION ALL
      SELECT strftime('%Y-%m-%d %H:00', datetime(hour, '+1 hour')), n + 1
      FROM hours WHERE n < 23
    ), aggregated AS (
      SELECT strftime('%Y-%m-%d %H:00', datetime(created_at), 'localtime') AS hour,
        SUM(cost_usd) AS total_cost_usd,
        COUNT(*) AS request_count,
        SUM(input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens) AS total_input_tokens,
        SUM(input_tokens) AS uncached_input_tokens,
        SUM(cache_read_tokens) AS cache_hit_tokens,
        SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write_tokens,
        SUM(output_tokens) AS total_output_tokens,
        SUM(reasoning_tokens) AS total_reasoning_tokens
      FROM usage_records
      ${accountFilter}
      GROUP BY hour
    )
    SELECT hours.hour AS date,
      COALESCE(aggregated.total_cost_usd, 0) AS total_cost_usd,
      COALESCE(aggregated.request_count, 0) AS request_count,
      COALESCE(aggregated.total_input_tokens, 0) AS total_input_tokens,
      COALESCE(aggregated.uncached_input_tokens, 0) AS uncached_input_tokens,
      COALESCE(aggregated.cache_hit_tokens, 0) AS cache_hit_tokens,
      COALESCE(aggregated.cache_write_tokens, 0) AS cache_write_tokens,
      COALESCE(aggregated.total_output_tokens, 0) AS total_output_tokens,
      COALESCE(aggregated.total_reasoning_tokens, 0) AS total_reasoning_tokens
    FROM hours LEFT JOIN aggregated ON aggregated.hour = hours.hour
    ORDER BY hours.hour DESC
  `).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...row,
    total_cost_usd: Math.round(Number(row.total_cost_usd) * 1e6) / 1e6,
    request_count: Number(row.request_count),
    total_input_tokens: Number(row.total_input_tokens),
    uncached_input_tokens: Number(row.uncached_input_tokens),
    cache_hit_tokens: Number(row.cache_hit_tokens),
    cache_write_tokens: Number(row.cache_write_tokens),
    total_output_tokens: Number(row.total_output_tokens),
    total_reasoning_tokens: Number(row.total_reasoning_tokens),
  }));
}

export function opencodeDailyModelStats(
  days = 30,
  accountId?: string | null,
): Record<string, unknown>[] {
  days = Math.max(1, Math.min(days, 365));
  let where = "WHERE substr(datetime(created_at, 'localtime'), 1, 10) >= date('now', 'localtime', ?)";
  const params: unknown[] = [`-${days} days`];
  if (accountId) {
    where += ' AND account_id = ?';
    params.push(accountId);
  }
  const rows = getDb()
    .prepare(
      `SELECT substr(datetime(created_at, 'localtime'), 1, 10) AS date,
              model,
              SUM(cost_usd) AS total_cost_usd,
              COUNT(*) AS request_count,
              SUM(input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens) AS total_input_tokens,
              SUM(input_tokens) AS uncached_input_tokens,
              SUM(cache_read_tokens) AS cache_hit_tokens,
              SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write_tokens,
              SUM(output_tokens) AS total_output_tokens,
              SUM(reasoning_tokens) AS total_reasoning_tokens
       FROM usage_records
       ${where}
       GROUP BY substr(datetime(created_at, 'localtime'), 1, 10), model
       ORDER BY date ASC, model ASC`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => ({
    date: r.date,
    model: r.model,
    total_cost_usd: Math.round(Number(r.total_cost_usd || 0) * 1e6) / 1e6,
    request_count: Number(r.request_count),
    total_input_tokens: Number(r.total_input_tokens || 0),
    uncached_input_tokens: Number(r.uncached_input_tokens || 0),
    cache_hit_tokens: Number(r.cache_hit_tokens || 0),
    cache_write_tokens: Number(r.cache_write_tokens || 0),
    total_output_tokens: Number(r.total_output_tokens || 0),
    total_reasoning_tokens: Number(r.total_reasoning_tokens || 0),
  }));
}

export function getUsageSyncState(accountId: string): UsageSyncStateRow {
  const row = getDb()
    .prepare('SELECT * FROM usage_sync_state WHERE account_id = ?')
    .get(accountId) as Record<string, unknown> | undefined;
  if (!row) {
    return {
      account_id: accountId,
      last_sync_at: null,
      last_sync_status: null,
      last_sync_error: null,
      last_success_at: null,
      last_failed_page: null,
      last_parse_error_count: 0,
      last_inserted_count: 0,
      deepest_page_fetched: -1,
      total_records: 0,
      oldest_record_at: null,
      newest_record_at: null,
    };
  }
  return {
    account_id: accountId,
    last_sync_at: row.last_sync_at != null ? String(row.last_sync_at) : null,
    last_sync_status: row.last_sync_status != null ? String(row.last_sync_status) : null,
    last_sync_error: row.last_sync_error != null ? String(row.last_sync_error) : null,
    last_success_at: row.last_success_at != null ? String(row.last_success_at) : null,
    last_failed_page: row.last_failed_page != null ? Number(row.last_failed_page) : null,
    last_parse_error_count: Number(row.last_parse_error_count || 0),
    last_inserted_count: Number(row.last_inserted_count),
    deepest_page_fetched: Number(row.deepest_page_fetched),
    total_records: Number(row.total_records),
    oldest_record_at: row.oldest_record_at != null ? String(row.oldest_record_at) : null,
    newest_record_at: row.newest_record_at != null ? String(row.newest_record_at) : null,
  };
}

export function updateUsageSyncState(accountId: string, fields: Record<string, unknown>): void {
  const allowed = new Set([
    'last_sync_at',
    'last_sync_status',
    'last_sync_error',
    'last_success_at',
    'last_failed_page',
    'last_parse_error_count',
    'last_inserted_count',
    'deepest_page_fetched',
    'total_records',
    'oldest_record_at',
    'newest_record_at',
  ]);
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key)) continue;
    updates.push(`${key} = ?`);
    values.push(value);
  }
  if (!updates.length) return;
  values.push(accountId);
  getDb()
    .prepare(`UPDATE usage_sync_state SET ${updates.join(', ')} WHERE account_id = ?`)
    .run(...values);
}

export function listUsageDataHealth(): Record<string, unknown>[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*, a.name AS account_name
       FROM usage_sync_state s
       JOIN opencode_accounts a ON a.id = s.account_id
       WHERE a.enabled = 1
       ORDER BY a.created_at ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const state = getUsageSyncState(String(row.account_id));
    return {
      account_id: state.account_id,
      account_name: String(row.account_name),
      ...usageSyncStateToDict(state),
    };
  });
}

export function refreshUsageSyncTotals(accountId: string): void {
  const conn = getDb();
  const row = conn
    .prepare(
      `SELECT COUNT(*) AS total,
              MIN(created_at) AS oldest,
              MAX(created_at) AS newest
       FROM usage_records WHERE account_id = ?`,
    )
    .get(accountId) as { total: number; oldest: string | null; newest: string | null };
  conn
    .prepare(
      `UPDATE usage_sync_state
       SET total_records = ?, oldest_record_at = ?, newest_record_at = ?
       WHERE account_id = ?`,
    )
    .run(row.total, row.oldest, row.newest, accountId);
}

export function hasServiceSettings(): boolean {
  const row = getDb().prepare('SELECT 1 AS x FROM service_settings WHERE id = 1').get();
  return !!row;
}

export function getServiceSettingsPayload(): Record<string, unknown> {
  const row = getDb().prepare('SELECT payload FROM service_settings WHERE id = 1').get() as
    | { payload: string }
    | undefined;
  if (!row) return {};
  try {
    const data = JSON.parse(row.payload);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function saveServiceSettingsPayload(payload: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO service_settings (id, payload, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(payload), nowIso());
}

export function opencodeModelTokenStats(
  period = '30d',
  accountId?: string | null,
): Record<string, unknown>[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (period === '5h') {
    clauses.push("datetime(created_at) >= datetime('now', '-5 hours')");
  } else if (period === 'today') {
    clauses.push("substr(datetime(created_at, 'localtime'), 1, 10) = date('now', 'localtime')");
  } else if (period !== 'all') {
    const days = Math.max(1, Number(/^(\d+)d$/.exec(period)?.[1] ?? 30));
    clauses.push("datetime(created_at) >= datetime('now', ?)");
    params.push(`-${days} days`);
  }
  if (accountId) {
    clauses.push('account_id = ?');
    params.push(accountId);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = getDb()
    .prepare(
      `SELECT model,
              COUNT(*) AS request_count,
              SUM(input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens) AS total_input_tokens,
              SUM(input_tokens) AS uncached_input_tokens,
              SUM(cache_read_tokens) AS cache_hit_tokens,
              SUM(cache_write_5m_tokens + cache_write_1h_tokens) AS cache_write_tokens,
              SUM(output_tokens) AS total_output_tokens,
              SUM(reasoning_tokens) AS total_reasoning_tokens,
              SUM(cost_usd) AS total_cost_usd
       FROM usage_records
       ${where}
       GROUP BY model
       ORDER BY (total_input_tokens + total_output_tokens) DESC`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => ({
    model: r.model,
    request_count: Number(r.request_count),
    total_input_tokens: Number(r.total_input_tokens || 0),
    uncached_input_tokens: Number(r.uncached_input_tokens || 0),
    cache_hit_tokens: Number(r.cache_hit_tokens || 0),
    cache_write_tokens: Number(r.cache_write_tokens || 0),
    total_output_tokens: Number(r.total_output_tokens || 0),
    total_reasoning_tokens: Number(r.total_reasoning_tokens || 0),
    total_cost_usd: Math.round(Number(r.total_cost_usd || 0) * 1e6) / 1e6,
  }));
}

export function countOpencodeAccounts(): number {
  return Number(
    (getDb().prepare('SELECT COUNT(*) AS c FROM opencode_accounts').get() as { c: number }).c,
  );
}

export function saveQuotaSnapshots(accounts: Array<Record<string, unknown>>): number {
  const conn = getDb();
  const insert = conn.prepare(`
    INSERT OR IGNORE INTO quota_snapshots (
      account_id, window_label, captured_at, used, remaining, total, reset_at, reset_in_sec
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const tx = conn.transaction(() => {
    for (const account of accounts) {
      if (!account.success || !account.account_id) continue;
      const capturedAt = String(account.updated_at || nowIso());
      for (const raw of (account.windows as Array<Record<string, unknown>> | undefined) ?? []) {
        inserted += insert.run(
          String(account.account_id), String(raw.label), capturedAt,
          Number(raw.used || 0), Number(raw.remaining || 0), Number(raw.total || 100),
          String(raw.reset_at || ''), Math.max(0, Number(raw.reset_in_sec || 0)),
        ).changes;
      }
    }
  });
  tx();
  return inserted;
}

export function listQuotaSnapshots(opts: {
  account_id?: string;
  window_label?: string;
  limit?: number;
} = {}): Array<Record<string, unknown>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.account_id) { where.push('qs.account_id = ?'); params.push(opts.account_id); }
  if (opts.window_label) { where.push('qs.window_label = ?'); params.push(opts.window_label); }
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
  return getDb().prepare(`
    SELECT qs.*, oa.name AS account_name
    FROM quota_snapshots qs
    JOIN opencode_accounts oa ON oa.id = qs.account_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY qs.captured_at DESC
    LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

export function listQuotaReconciliationInputs(accountId?: string): Array<Record<string, unknown>> {
  const params: unknown[] = accountId ? [accountId] : [];
  const accountWhere = accountId ? 'WHERE account_id = ?' : '';
  return getDb().prepare(`
    WITH ordered AS (
      SELECT qs.*,
        LAG(captured_at) OVER window_rows AS previous_captured_at,
        LAG(used) OVER window_rows AS previous_used,
        LAG(remaining) OVER window_rows AS previous_remaining,
        LAG(total) OVER window_rows AS previous_total,
        LAG(reset_at) OVER window_rows AS previous_reset_at
      FROM quota_snapshots qs
      ${accountWhere}
      WINDOW window_rows AS (PARTITION BY account_id, window_label ORDER BY captured_at)
    )
    SELECT ordered.*, oa.name AS account_name,
      (SELECT COUNT(*) FROM usage_records ur
       WHERE ur.account_id = ordered.account_id
         AND ur.created_at > ordered.previous_captured_at
         AND ur.created_at <= ordered.captured_at) AS local_request_count,
      (SELECT COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens), 0)
       FROM usage_records ur
       WHERE ur.account_id = ordered.account_id
         AND ur.created_at > ordered.previous_captured_at
         AND ur.created_at <= ordered.captured_at) AS local_tokens
    FROM ordered
    JOIN opencode_accounts oa ON oa.id = ordered.account_id
    WHERE ordered.previous_captured_at IS NOT NULL
    ORDER BY ordered.captured_at DESC
    LIMIT 5000
  `).all(...params) as Array<Record<string, unknown>>;
}

export function listQuotaWeightRules(): Array<Record<string, unknown>> {
  return getDb().prepare(`
    SELECT qwr.*, oa.name AS account_name
    FROM quota_weight_rules qwr
    LEFT JOIN opencode_accounts oa ON oa.id = qwr.account_id
    ORDER BY qwr.effective_from DESC, qwr.created_at DESC
  `).all() as Array<Record<string, unknown>>;
}

export function createQuotaWeightRule(input: {
  account_id?: string | null;
  plan?: string | null;
  model_pattern: string;
  weight: number;
  effective_from: string;
  source?: string;
  sample_count?: number;
  confidence?: number;
}): Record<string, unknown> {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO quota_weight_rules (
      id, account_id, plan, model_pattern, weight, effective_from,
      source, sample_count, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.account_id || null, input.plan || null, input.model_pattern.trim() || '*',
    Math.max(0.0001, input.weight), input.effective_from, input.source || 'manual',
    Math.max(0, input.sample_count || 0), Math.max(0, Math.min(1, input.confidence || 0)), nowIso(),
  );
  return getDb().prepare('SELECT * FROM quota_weight_rules WHERE id = ?').get(id) as Record<string, unknown>;
}

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

export function opencodeQuotaUnitStats(period = '30d', accountId?: string): Record<string, unknown> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (period === '5h') clauses.push("datetime(created_at) >= datetime('now', '-5 hours')");
  else if (period === 'today') clauses.push("substr(datetime(created_at, 'localtime'), 1, 10) = date('now', 'localtime')");
  else if (period !== 'all') {
    const days = Math.max(1, Number(/^(\d+)d$/.exec(period)?.[1] ?? 30));
    clauses.push("datetime(created_at) >= datetime('now', ?)");
    params.push(`-${days} days`);
  }
  if (accountId) { clauses.push('account_id = ?'); params.push(accountId); }
  const records = getDb().prepare(`
    SELECT account_id, plan, model, created_at,
      input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens AS processed_tokens
    FROM usage_records ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
  `).all(...params) as Array<Record<string, unknown>>;
  const rules = listQuotaWeightRules();
  const byModel = new Map<string, { units: number; tokens: number; requests: number }>();
  let totalUnits = 0;
  for (const record of records) {
    const candidates = rules.filter((rule) =>
      (!rule.account_id || rule.account_id === record.account_id) &&
      (!rule.plan || rule.plan === record.plan) &&
      String(rule.effective_from) <= String(record.created_at) &&
      globMatches(String(rule.model_pattern), String(record.model)));
    candidates.sort((a, b) =>
      Number(Boolean(b.account_id)) - Number(Boolean(a.account_id)) ||
      Number(Boolean(b.plan)) - Number(Boolean(a.plan)) ||
      String(b.effective_from).localeCompare(String(a.effective_from)) ||
      String(b.model_pattern).length - String(a.model_pattern).length);
    const weight = Number(candidates[0]?.weight || 1);
    const tokens = Number(record.processed_tokens || 0);
    const units = tokens / 1_000_000 * weight;
    totalUnits += units;
    const model = String(record.model);
    const current = byModel.get(model) ?? { units: 0, tokens: 0, requests: 0 };
    current.units += units; current.tokens += tokens; current.requests += 1;
    byModel.set(model, current);
  }
  return {
    period, total_quota_units: Math.round(totalUnits * 10000) / 10000,
    request_count: records.length,
    models: [...byModel.entries()].map(([model, stat]) => ({
      model, quota_units: Math.round(stat.units * 10000) / 10000,
      processed_tokens: stat.tokens, request_count: stat.requests,
    })).sort((a, b) => b.quota_units - a.quota_units),
  };
}

export function autoCalibrateQuotaWeights(accountId?: string): Array<Record<string, unknown>> {
  const intervals = listQuotaReconciliationInputs(accountId);
  const samples = new Map<string, Array<{ weight: number; share: number; capturedAt: string }>>();
  const conn = getDb();
  for (const interval of intervals) {
    const usedDelta = Number(interval.used) - Number(interval.previous_used);
    const elapsedHours = (Date.parse(String(interval.captured_at)) - Date.parse(String(interval.previous_captured_at))) / 3600000;
    if (
      String(interval.reset_at) !== String(interval.previous_reset_at) ||
      Number(interval.total) !== Number(interval.previous_total) ||
      usedDelta <= 0 || usedDelta > 50 || elapsedHours <= 0 ||
      Number(interval.local_request_count || 0) <= 0
    ) continue;
    const models = conn.prepare(`
      SELECT model, plan,
        SUM(input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens) AS tokens
      FROM usage_records
      WHERE account_id = ? AND created_at > ? AND created_at <= ?
      GROUP BY model, plan
      ORDER BY tokens DESC
    `).all(interval.account_id, interval.previous_captured_at, interval.captured_at) as Array<Record<string, unknown>>;
    const totalTokens = models.reduce((sum, row) => sum + Number(row.tokens || 0), 0);
    const dominant = models[0];
    if (!dominant || totalTokens <= 0) continue;
    const share = Number(dominant.tokens) / totalTokens;
    if (share < 0.8) continue;
    const weight = usedDelta / (totalTokens / 1_000_000);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const key = [interval.account_id, String(dominant.plan || ''), dominant.model].join('\u0000');
    const group = samples.get(key) ?? [];
    group.push({ weight, share, capturedAt: String(interval.captured_at) });
    samples.set(key, group);
  }

  const created: Array<Record<string, unknown>> = [];
  for (const [key, group] of samples) {
    if (group.length < 2) continue;
    const [calibrationAccountId, plan, model] = key.split('\u0000');
    const sorted = group.map((sample) => sample.weight).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const observed = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const weight = Math.max(0.05, Math.min(1000, observed));
    const confidence = Math.min(1, group.length / 6) *
      (group.reduce((sum, sample) => sum + sample.share, 0) / group.length);
    const latest = listQuotaWeightRules().find((rule) =>
      rule.source === 'auto' && rule.account_id === calibrationAccountId &&
      String(rule.plan || '') === plan && rule.model_pattern === model);
    if (latest && Math.abs(Number(latest.weight) - weight) / Number(latest.weight) < 0.05) continue;
    created.push(createQuotaWeightRule({
      account_id: calibrationAccountId, plan: plan || null, model_pattern: model,
      weight, effective_from: group.map((sample) => sample.capturedAt).sort()[group.length - 1],
      source: 'auto', sample_count: group.length, confidence,
    }));
  }
  return created;
}

export function listUsageRecordsForExport(): UsageRecordWithAccount[] {
  const rows = getDb().prepare(`
    SELECT ur.*, oa.name AS account_name
    FROM usage_records ur
    JOIN opencode_accounts oa ON oa.id = ur.account_id
    ORDER BY ur.created_at DESC
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...mapUsage(row), account_name: String(row.account_name) }));
}

export function createDatabaseBackup(): Buffer {
  const conn = getDb();
  conn.pragma('wal_checkpoint(TRUNCATE)');
  return fs.readFileSync(dbPath());
}

export function validateDatabaseFile(filePath: string): { schemaVersion: number } {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error('database integrity check failed');
    }
    const tables = new Set((candidate.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as Array<{ name: string }>).map((row) => row.name));
    for (const required of ['opencode_accounts', 'usage_records', 'usage_sync_state', 'service_settings']) {
      if (!tables.has(required)) throw new Error(`missing required table: ${required}`);
    }
    const schemaVersion = Number(candidate.pragma('user_version', { simple: true }));
    if (schemaVersion < 1 || schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(`unsupported schema version: ${schemaVersion}`);
    }
    return { schemaVersion };
  } finally {
    candidate.close();
  }
}

export function restoreDatabaseBackup(contents: Buffer): { schemaVersion: number } {
  fs.mkdirSync(dataDir(), { recursive: true });
  const target = dbPath();
  const candidate = path.join(dataDir(), `.restore-${randomUUID()}.db`);
  const rollback = path.join(dataDir(), `.rollback-${randomUUID()}.db`);
  fs.writeFileSync(candidate, contents);
  try {
    const validation = validateDatabaseFile(candidate);
    closeDb();
    if (fs.existsSync(target)) fs.renameSync(target, rollback);
    fs.renameSync(candidate, target);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${target}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
    }
    try {
      initDb();
      if (fs.existsSync(rollback)) fs.rmSync(rollback);
      return validation;
    } catch (error) {
      closeDb();
      if (fs.existsSync(target)) fs.rmSync(target);
      if (fs.existsSync(rollback)) fs.renameSync(rollback, target);
      initDb();
      throw error;
    }
  } finally {
    if (fs.existsSync(candidate)) fs.rmSync(candidate);
  }
}
