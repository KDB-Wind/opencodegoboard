import Database from 'better-sqlite3';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const rows = Number(process.env.BENCHMARK_ROWS || 100_000);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'opencodegoboard-benchmark-'));
const databasePath = join(temporaryRoot, 'benchmark.db');
const db = new Database(databasePath);
const elapsed = (started) => Math.round((performance.now() - started) * 100) / 100;

try {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE usage_records (
      usg_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at TEXT NOT NULL,
      model TEXT NOT NULL, plan TEXT, project_path TEXT, input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL, reasoning_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL
    );
    CREATE INDEX idx_usage_account_time ON usage_records(account_id, created_at DESC);
    CREATE INDEX idx_usage_session_time ON usage_records(account_id, project_path, created_at DESC);
    CREATE INDEX idx_usage_time_model ON usage_records(created_at DESC, model, account_id);
    CREATE INDEX idx_usage_account_plan_model_time ON usage_records(account_id, plan, model, created_at DESC);
  `);
  const insert = db.prepare(`INSERT INTO usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertAll = db.transaction(() => {
    const base = Date.now();
    for (let i = 0; i < rows; i += 1) {
      insert.run(`usg-${i}`, `account-${i % 4}`, new Date(base - i * 60_000).toISOString(),
        `model-${i % 12}`, `plan-${i % 2}`, `project-${i % 40}`,
        1000 + i % 300, 300 + i % 100, i % 50, 700 + i % 200, (i % 1000) / 100000);
    }
  });
  const insertStarted = performance.now();
  insertAll();
  const insertMs = elapsed(insertStarted);

  const queries = [
    db.prepare(`SELECT substr(created_at, 1, 10) day, SUM(cost_usd), SUM(input_tokens + output_tokens + reasoning_tokens), COUNT(*) FROM usage_records WHERE created_at >= ? GROUP BY day ORDER BY day`),
    db.prepare(`SELECT model, SUM(cost_usd), SUM(input_tokens), SUM(output_tokens), COUNT(*) FROM usage_records WHERE account_id = ? AND created_at >= ? GROUP BY model ORDER BY SUM(cost_usd) DESC`),
    db.prepare(`SELECT project_path, SUM(cost_usd), SUM(cache_read_tokens), COUNT(*) FROM usage_records WHERE account_id = ? GROUP BY project_path ORDER BY SUM(cost_usd) DESC LIMIT 20`),
  ];
  const durations = [];
  for (let round = 0; round < 25; round += 1) {
    for (const [index, query] of queries.entries()) {
      const started = performance.now();
      if (index === 0) query.all('2020-01-01');
      else if (index === 1) query.all('account-1', '2020-01-01');
      else query.all('account-1');
      durations.push(performance.now() - started);
    }
  }
  durations.sort((a, b) => a - b);
  db.pragma('wal_checkpoint(TRUNCATE)');
  const size = (await stat(databasePath)).size;
  console.log(JSON.stringify({ rows, insert_ms: insertMs,
    aggregation_ms: { median: Number(durations[Math.floor(durations.length * 0.5)].toFixed(2)), p95: Number(durations[Math.floor(durations.length * 0.95)].toFixed(2)), max: Number(durations.at(-1).toFixed(2)) },
    database_mb: Number((size / 1024 / 1024).toFixed(2)), rss_mb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)) }, null, 2));
} finally {
  db.close();
  const resolved = resolve(temporaryRoot);
  if (!resolved.startsWith(resolve(tmpdir())) || !resolved.includes('opencodegoboard-benchmark-')) throw new Error('Refusing to remove unexpected benchmark directory');
  await rm(resolved, { recursive: true, force: true });
}
