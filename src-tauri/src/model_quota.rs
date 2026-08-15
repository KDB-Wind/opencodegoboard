use serde_json::{json, Value};
use std::collections::HashMap;

pub const CREATE_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS model_quota_tiers (
    model_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    monthly_quota_usd REAL NOT NULL,
    input_price_usd REAL,
    output_price_usd REAL,
    cache_read_price_usd REAL,
    cache_write_price_usd REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    source_url TEXT,
    updated_at TEXT NOT NULL
)"#;

pub const SEED_SOURCE: &str = "opencode-docs-2026-08-15";
pub const SEED_SOURCE_URL: &str = "https://opencode.ai/docs/zh-cn/go/";

const SEED_ROWS: &[(&str, f64)] = &[
    ("grok-4-5", 15.0),
    ("gpt-5-6-luna", 15.0),
    ("glm-5-3", 15.0),
    ("glm-5-2", 60.0),
    ("glm-5-1", 60.0),
    ("kimi-k3", 15.0),
    ("kimi-k2-7-code", 60.0),
    ("kimi-k2-6", 60.0),
    ("mimo-v2-5", 60.0),
    ("mimo-v2-5-pro", 15.0),
    ("minimax-m3", 60.0),
    ("minimax-m2-7", 60.0),
    ("minimax-m2-5", 60.0),
    ("qwen3-8-max", 15.0),
    ("qwen3-7-max", 60.0),
    ("qwen3-7-plus", 60.0),
    ("qwen3-6-plus", 60.0),
    ("deepseek-v4-pro", 15.0),
    ("deepseek-v4-flash", 60.0),
    ("hy3", 60.0),
];

fn display_name(key: &str) -> String {
    match key {
        "grok-4-5" => "Grok 4.5",
        "gpt-5-6-luna" => "GPT 5.6 Luna",
        "glm-5-3" => "GLM-5.3",
        "glm-5-2" => "GLM-5.2",
        "glm-5-1" => "GLM-5.1",
        "kimi-k3" => "Kimi K3",
        "kimi-k2-7-code" => "Kimi K2.7 Code",
        "kimi-k2-6" => "Kimi K2.6",
        "mimo-v2-5" => "MiMo V2.5",
        "mimo-v2-5-pro" => "MiMo V2.5 Pro",
        "minimax-m3" => "MiniMax M3",
        "minimax-m2-7" => "MiniMax M2.7",
        "minimax-m2-5" => "MiniMax M2.5",
        "qwen3-8-max" => "Qwen3.8 Max",
        "qwen3-7-max" => "Qwen3.7 Max",
        "qwen3-7-plus" => "Qwen3.7 Plus",
        "qwen3-6-plus" => "Qwen3.6 Plus",
        "deepseek-v4-pro" => "DeepSeek V4 Pro",
        "deepseek-v4-flash" => "DeepSeek V4 Flash",
        "hy3" => "Hy3",
        _ => key,
    }
    .to_string()
}

/// Normalizes free-form model names so "DeepSeek V4 Pro", "deepseek-v4-pro"
/// and "deepseek v4 pro" match the same tier row.
pub fn normalize_model(name: &str) -> String {
    let lower = name.to_lowercase();
    let without_parentheses = lower.split('(').next().unwrap_or(&lower).trim();
    let mut out = String::new();
    let mut pending_dash = false;
    for ch in without_parentheses.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            out.push(ch);
            pending_dash = false;
        } else {
            pending_dash = true;
        }
    }
    out
}

pub fn seed_defaults(conn: &rusqlite::Connection) -> Result<usize, String> {
    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut inserted = 0;
    for (key, quota) in SEED_ROWS {
        inserted += conn
            .execute(
                "INSERT OR IGNORE INTO model_quota_tiers(model_key,display_name,monthly_quota_usd,source,source_url,updated_at) VALUES(?,?,?,?,?,?)",
                rusqlite::params![key, display_name(key), quota, SEED_SOURCE, SEED_SOURCE_URL, timestamp],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(inserted)
}

pub fn list(conn: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare("SELECT model_key,display_name,monthly_quota_usd,input_price_usd,output_price_usd,cache_read_price_usd,cache_write_price_usd,source,source_url,updated_at FROM model_quota_tiers ORDER BY display_name")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "model_key": row.get::<_, String>(0)?,
                "display_name": row.get::<_, String>(1)?,
                "monthly_quota_usd": row.get::<_, f64>(2)?,
                "multiplier": if row.get::<_, f64>(2)? > 0.0 { 60.0 / row.get::<_, f64>(2)? } else { 1.0 },
                "input_price_usd": row.get::<_, Option<f64>>(3)?,
                "output_price_usd": row.get::<_, Option<f64>>(4)?,
                "cache_read_price_usd": row.get::<_, Option<f64>>(5)?,
                "cache_write_price_usd": row.get::<_, Option<f64>>(6)?,
                "source": row.get::<_, String>(7)?,
                "source_url": row.get::<_, Option<String>>(8)?,
                "updated_at": row.get::<_, String>(9)?,
            }))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

fn multipliers(conn: &rusqlite::Connection) -> Result<HashMap<String, f64>, String> {
    let mut statement = conn
        .prepare("SELECT model_key,monthly_quota_usd FROM model_quota_tiers")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)))
        .map_err(|error| error.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (key, quota) = row.map_err(|error| error.to_string())?;
        if quota > 0.0 {
            map.insert(key, 60.0 / quota);
        }
    }
    Ok(map)
}

/// Sums `cost_usd * tier_multiplier` over per-model stats. Unknown models
/// default to the 60-dollar tier (multiplier 1) until the user adds a row.
pub fn equivalent_cost(conn: &rusqlite::Connection, model_stats: &[Value]) -> Result<f64, String> {
    let map = multipliers(conn)?;
    let mut total = 0.0;
    for row in model_stats {
        let cost = row["total_cost_usd"].as_f64().unwrap_or(0.0);
        let model = row["model"].as_str().unwrap_or_default();
        let multiplier = map.get(&normalize_model(model)).copied().unwrap_or(1.0);
        total += cost * multiplier;
    }
    Ok((total * 10_000.0).round() / 10_000.0)
}

pub fn upsert(conn: &rusqlite::Connection, body: &Value) -> Result<Value, String> {
    let display_name = body
        .get("display_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "display_name is required".to_string())?;
    let monthly_quota = body
        .get("monthly_quota_usd")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| "monthly_quota_usd must be a positive number".to_string())?;
    let model_key = normalize_model(display_name);
    if model_key.is_empty() {
        return Err("model name must contain letters or digits".to_string());
    }
    let optional = |key: &str| {
        body.get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0)
    };
    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    conn.execute(
        "INSERT INTO model_quota_tiers(model_key,display_name,monthly_quota_usd,input_price_usd,output_price_usd,cache_read_price_usd,cache_write_price_usd,source,source_url,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(model_key) DO UPDATE SET display_name=excluded.display_name,monthly_quota_usd=excluded.monthly_quota_usd,input_price_usd=excluded.input_price_usd,output_price_usd=excluded.output_price_usd,cache_read_price_usd=excluded.cache_read_price_usd,cache_write_price_usd=excluded.cache_write_price_usd,source=excluded.source,source_url=excluded.source_url,updated_at=excluded.updated_at",
        rusqlite::params![
            model_key,
            display_name,
            monthly_quota,
            optional("input_price_usd"),
            optional("output_price_usd"),
            optional("cache_read_price_usd"),
            optional("cache_write_price_usd"),
            "manual",
            Option::<String>::None,
            timestamp,
        ],
    )
    .map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare("SELECT model_key,display_name,monthly_quota_usd,input_price_usd,output_price_usd,cache_read_price_usd,cache_write_price_usd,source,source_url,updated_at FROM model_quota_tiers WHERE model_key=?")
        .map_err(|error| error.to_string())?;
    statement
        .query_row([model_key], |row| {
            Ok(json!({
                "model_key": row.get::<_, String>(0)?,
                "display_name": row.get::<_, String>(1)?,
                "monthly_quota_usd": row.get::<_, f64>(2)?,
                "multiplier": if row.get::<_, f64>(2)? > 0.0 { 60.0 / row.get::<_, f64>(2)? } else { 1.0 },
                "input_price_usd": row.get::<_, Option<f64>>(3)?,
                "output_price_usd": row.get::<_, Option<f64>>(4)?,
                "cache_read_price_usd": row.get::<_, Option<f64>>(5)?,
                "cache_write_price_usd": row.get::<_, Option<f64>>(6)?,
                "source": row.get::<_, String>(7)?,
                "source_url": row.get::<_, Option<String>>(8)?,
                "updated_at": row.get::<_, String>(9)?,
            }))
        })
        .map_err(|error| error.to_string())
}

pub fn delete(conn: &rusqlite::Connection, model_key: &str) -> Result<bool, String> {
    let key = normalize_model(model_key);
    let changed = conn
        .execute("DELETE FROM model_quota_tiers WHERE model_key=?", [key])
        .map_err(|error| error.to_string())?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_model_names() {
        assert_eq!(normalize_model("DeepSeek V4 Pro"), "deepseek-v4-pro");
        assert_eq!(normalize_model("deepseek-v4-pro"), "deepseek-v4-pro");
        assert_eq!(normalize_model("GPT 5.6 Luna (≤ 272K tokens)"), "gpt-5-6-luna");
        assert_eq!(normalize_model("Qwen3.7 Plus"), "qwen3-7-plus");
    }

    #[test]
    fn seeds_and_computes_equivalent_cost() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(CREATE_TABLE_SQL).unwrap();
        assert!(seed_defaults(&conn).unwrap() > 0);
        let stats = vec![
            json!({"model": "deepseek-v4-flash", "total_cost_usd": 10.0}),
            json!({"model": "deepseek-v4-pro", "total_cost_usd": 5.0}),
            json!({"model": "unknown-model", "total_cost_usd": 2.0}),
        ];
        assert_eq!(equivalent_cost(&conn, &stats).unwrap(), 32.0);
        let rows = list(&conn).unwrap();
        assert!(rows.iter().any(|row| row["display_name"] == "DeepSeek V4 Pro" && row["multiplier"] == 4.0));
    }

    #[test]
    fn users_can_maintain_model_quota_rows() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(CREATE_TABLE_SQL).unwrap();
        let created = upsert(&conn, &json!({"display_name": "My Model", "monthly_quota_usd": 30.0, "input_price_usd": 0.5})).unwrap();
        assert_eq!(created["model_key"], "my-model");
        assert_eq!(created["multiplier"], 2.0);
        assert_eq!(delete(&conn, "My Model").unwrap(), true);
        assert!(list(&conn).unwrap().is_empty());
    }
}
