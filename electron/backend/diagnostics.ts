import { createHash } from 'crypto';
import * as db from './db';

const SECRET_KEY = /(authorization|cookie|token|secret|password|auth_cookie)/i;
const PRIVATE_KEY = /(workspace|session|project_path|email|user_id|key_id)/i;

function fingerprint(value: unknown): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

export function redactDiagnosticValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (PRIVATE_KEY.test(key) && value != null && value !== '') return `[HASH:${fingerprint(value)}]`;
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactDiagnosticValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function sanitizeFixtureText(input: string): string {
  return input
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,"']+/gi, '$1[REDACTED]')
    .replace(/((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b(?:wrk|ses|user|key)[_-][a-z0-9_-]{6,}\b/gi, (value) => `[ID:${fingerprint(value)}]`)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, (value) => `[UUID:${fingerprint(value)}]`)
    .replace(/(["'](?:auth_cookie|token|secret|password)["']\s*:\s*["'])[^"']+(["'])/gi, '$1[REDACTED]$2');
}

export function buildDiagnosticReport(): Record<string, unknown> {
  const conn = db.getDb();
  const counts = Object.fromEntries(
    ['opencode_accounts', 'usage_records', 'usage_sync_state', 'quota_snapshots', 'quota_weight_rules', 'session_contexts']
      .map((table) => {
        const row = conn.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
        return [table, row.count];
      }),
  );
  const accounts = db.listOpencodeAccounts().map((account) => ({
    id: `[HASH:${fingerprint(account.id)}]`,
    name: `[ACCOUNT:${fingerprint(account.name)}]`,
    enabled: Boolean(account.enabled),
    configured: Boolean(account.auth_cookie),
    workspace_configured: Boolean(account.workspace_id),
  }));
  return redactDiagnosticValue({
    format: 'opencodegoboard-diagnostics',
    format_version: 1,
    generated_at: new Date().toISOString(),
    app_version: process.env.npm_package_version ?? 'unknown',
    runtime: { platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron ?? null },
    database: { schema_version: db.getSchemaVersion(), counts },
    accounts,
    data_health: db.listUsageDataHealth(),
  }) as Record<string, unknown>;
}
