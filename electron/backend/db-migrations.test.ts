import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { setDataDir } from './config';
import {
  CURRENT_SCHEMA_VERSION,
  closeDb,
  dbPath,
  getDb,
  getSchemaVersion,
  initDb,
  createOpencodeAccount,
  insertUsageRecordsIgnore,
  listUsageRecords,
} from './db';

let testDir = '';

describe('database migrations', () => {
  beforeEach(() => {
    closeDb();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencodegoboard-db-'));
    setDataDir(testDir);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates the current schema and is idempotent', () => {
    initDb();
    expect(getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
    expect(
      (getDb().pragma('table_info(usage_records)') as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    ).toEqual(expect.arrayContaining(['cache_read_tokens', 'cache_write_1h_tokens']));
    expect(
      (getDb().pragma('table_info(usage_sync_state)') as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'last_success_at',
        'last_failed_page',
        'last_parse_error_count',
      ]),
    );
    expect(
      (getDb().pragma('table_info(usage_records)') as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    ).toEqual(expect.arrayContaining(['reasoning_tokens', 'session_id']));

    expect(() => initDb()).not.toThrow();
    expect(getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('upgrades a version-zero legacy database in transactions', () => {
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    const legacy = new Database(dbPath());
    legacy.exec(`
      CREATE TABLE opencode_accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace_id TEXT NOT NULL,
        resolved_workspace_id TEXT, auth_cookie TEXT NOT NULL,
        show_rolling INTEGER NOT NULL DEFAULT 1, show_weekly INTEGER NOT NULL DEFAULT 1,
        show_monthly INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE usage_records (
        usg_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        created_at TEXT NOT NULL, model TEXT NOT NULL, provider TEXT,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cost_raw INTEGER NOT NULL, cost_usd REAL NOT NULL, key_id TEXT, plan TEXT,
        synced_at TEXT NOT NULL
      );
      INSERT INTO opencode_accounts VALUES
        ('a', 'A', 'Default', NULL, '', 1, 1, 1, 1, 'now', 'now');
      INSERT INTO usage_records VALUES
        ('u', 'a', 'wrk', 'now', 'm', NULL, 1, 1, 100000000, 0.1, NULL, NULL, 'now');
    `);
    legacy.close();

    initDb();

    expect(getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
    const row = getDb().prepare('SELECT cost_usd, cache_read_tokens FROM usage_records').get() as {
      cost_usd: number;
      cache_read_tokens: number;
    };
    expect(row).toEqual({ cost_usd: 1, cache_read_tokens: 0 });
  });

  it('persists reasoning tokens and session attribution', () => {
    initDb();
    const account = createOpencodeAccount({
      name: 'A',
      workspace_id: 'wrk_a',
      auth_cookie: 'secret',
    });
    expect(
      insertUsageRecordsIgnore(account.id, 'wrk_a', [
        {
          usg_id: 'usg_reasoning',
          created_at: '2026-08-15T00:00:00Z',
          model: 'model',
          provider: 'provider',
          input_tokens: 10,
          output_tokens: 2,
          reasoning_tokens: 7,
          cache_read_tokens: 0,
          cache_write_5m_tokens: 0,
          cache_write_1h_tokens: 0,
          cost_raw: 10,
          cost_usd: 0.0000001,
          key_id: null,
          session_id: 'ses_test',
          plan: null,
        },
      ]),
    ).toBe(1);
    const [records] = listUsageRecords(account.id);
    expect(records[0]).toMatchObject({
      reasoning_tokens: 7,
      session_id: 'ses_test',
    });
  });
});
