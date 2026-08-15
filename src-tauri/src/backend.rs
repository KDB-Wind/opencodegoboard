use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{Duration, NaiveDate, SecondsFormat, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{functions::FunctionFlags, params, params_from_iter, types::{Value as SqlValue, ValueRef}, Connection};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{fs, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::Instant};
use std::collections::HashMap;
use url::Url;
use uuid::Uuid;
use crate::features::{self, ADVANCED_SYNC, DATA_TOOLS, QUOTA_INTELLIGENCE, TOKEN_STATS, USAGE_RECORDS};
use crate::quota::{self, QuotaAccount};

const SCHEMA_VERSION: i64 = 8;

#[derive(Clone)]
pub struct BackendState {
    pub db_path: PathBuf,
    pub settings: Arc<Mutex<Value>>,
    pub quota_refresh_running: Arc<Mutex<bool>>,
    pub quota_last_refresh: Arc<Mutex<Option<Instant>>>,
}

#[derive(Deserialize)]
pub struct ApiRequest { pub method: String, pub path: String, pub body: Option<Value> }

fn now() -> String { Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true) }
fn parse_timezone(value: &str) -> Tz { value.parse().unwrap_or(chrono_tz::Asia::Shanghai) }
fn timezone_name(state: &BackendState) -> String {
    state.settings.lock().ok().and_then(|settings|settings["timezone"].as_str().map(str::to_owned)).unwrap_or_else(||"Asia/Shanghai".into())
}
fn settings_snapshot(state: &BackendState) -> Result<Value, String> {
    state.settings.lock().map(|settings| settings.clone()).map_err(|_| "settings lock poisoned".into())
}
fn feature_enabled(state: &BackendState, key: &str) -> Result<bool, String> {
    Ok(features::is_enabled(&settings_snapshot(state)?, key))
}
fn require_feature(state: &BackendState, key: &str) -> Result<(), String> {
    if feature_enabled(state, key)? { Ok(()) } else { Err("feature_disabled".into()) }
}
fn period_start(days: i64, timezone: &str) -> String {
    let zone=parse_timezone(timezone);
    let date=Utc::now().with_timezone(&zone).date_naive()-Duration::days((days-1).max(0));
    zone.from_local_datetime(&date.and_hms_opt(0,0,0).expect("valid midnight")).earliest().unwrap_or_else(||Utc::now().with_timezone(&zone)).with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Secs,true)
}
fn configure_connection(conn:&Connection)->Result<(),String>{
    let flags=FunctionFlags::SQLITE_UTF8|FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function("tz_date",2,flags,|ctx|{let timestamp:String=ctx.get(0)?;let timezone:String=ctx.get(1)?;Ok(chrono::DateTime::parse_from_rfc3339(&timestamp).map(|value|value.with_timezone(&parse_timezone(&timezone)).format("%Y-%m-%d").to_string()).unwrap_or_default())}).map_err(|e|e.to_string())?;
    conn.create_scalar_function("tz_hour",2,flags,|ctx|{let timestamp:String=ctx.get(0)?;let timezone:String=ctx.get(1)?;Ok(chrono::DateTime::parse_from_rfc3339(&timestamp).map(|value|value.with_timezone(&parse_timezone(&timezone)).format("%H").to_string()).unwrap_or_default())}).map_err(|e|e.to_string())
}
fn sql_value(value: &Value) -> SqlValue {
    match value { Value::Null => SqlValue::Null, Value::Bool(v) => SqlValue::Integer(*v as i64),
        Value::Number(v) if v.is_i64() => SqlValue::Integer(v.as_i64().unwrap_or_default()),
        Value::Number(v) => SqlValue::Real(v.as_f64().unwrap_or_default()),
        Value::String(v) => SqlValue::Text(v.clone()), value => SqlValue::Text(value.to_string()) }
}

fn query_json(conn: &Connection, sql: &str, args: &[Value]) -> Result<Vec<Value>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = statement.column_names().iter().map(|name| name.to_string()).collect();
    let values: Vec<SqlValue> = args.iter().map(sql_value).collect();
    let rows = statement.query_map(params_from_iter(values), |row| {
        let mut object = Map::new();
        for (index, name) in names.iter().enumerate() {
            let value = match row.get_ref(index)? { ValueRef::Null => Value::Null,
                ValueRef::Integer(v) => json!(v), ValueRef::Real(v) => json!(v),
                ValueRef::Text(v) => Value::String(String::from_utf8_lossy(v).into_owned()),
                ValueRef::Blob(v) => Value::String(BASE64.encode(v)) };
            object.insert(name.clone(), value);
        }
        Ok(Value::Object(object))
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn one(conn: &Connection, sql: &str, args: &[Value]) -> Result<Value, String> {
    Ok(query_json(conn, sql, args)?.into_iter().next().unwrap_or(Value::Null))
}

pub fn initialize(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    let installed: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if installed > SCHEMA_VERSION { return Err(format!("database schema {installed} is newer than supported {SCHEMA_VERSION}")); }
    conn.execute_batch(r#"
      CREATE TABLE IF NOT EXISTS opencode_accounts (id TEXT PRIMARY KEY,name TEXT NOT NULL,workspace_id TEXT NOT NULL DEFAULT 'Default',resolved_workspace_id TEXT,auth_cookie TEXT NOT NULL,show_rolling INTEGER NOT NULL DEFAULT 1,show_weekly INTEGER NOT NULL DEFAULT 1,show_monthly INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_records (usg_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES opencode_accounts(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL,created_at TEXT NOT NULL,model TEXT NOT NULL,provider TEXT,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cache_read_tokens INTEGER NOT NULL DEFAULT 0,cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,cost_raw INTEGER NOT NULL,cost_usd REAL NOT NULL,key_id TEXT,plan TEXT,synced_at TEXT NOT NULL,reasoning_tokens INTEGER NOT NULL DEFAULT 0,session_id TEXT,project_path TEXT,session_title TEXT);
      CREATE TABLE IF NOT EXISTS usage_sync_state (account_id TEXT PRIMARY KEY REFERENCES opencode_accounts(id) ON DELETE CASCADE,last_sync_at TEXT,last_sync_status TEXT,last_sync_error TEXT,last_inserted_count INTEGER NOT NULL DEFAULT 0,deepest_page_fetched INTEGER NOT NULL DEFAULT -1,total_records INTEGER NOT NULL DEFAULT 0,oldest_record_at TEXT,newest_record_at TEXT,last_success_at TEXT,last_failed_page INTEGER,last_parse_error_count INTEGER NOT NULL DEFAULT 0);
    "#).map_err(|e|e.to_string())?;
    let usage_columns:Vec<String>=conn.prepare("PRAGMA table_info(usage_records)").map_err(|e|e.to_string())?.query_map([],|row|row.get(1)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    for(name,declaration)in [("reasoning_tokens","INTEGER NOT NULL DEFAULT 0"),("session_id","TEXT"),("project_path","TEXT"),("session_title","TEXT")]{if !usage_columns.iter().any(|column|column==name){conn.execute(&format!("ALTER TABLE usage_records ADD COLUMN {name} {declaration}"),[]).map_err(|e|e.to_string())?;}}
    let sync_columns:Vec<String>=conn.prepare("PRAGMA table_info(usage_sync_state)").map_err(|e|e.to_string())?.query_map([],|row|row.get(1)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;
    for(name,declaration)in [("last_success_at","TEXT"),("last_failed_page","INTEGER"),("last_parse_error_count","INTEGER NOT NULL DEFAULT 0")]{if !sync_columns.iter().any(|column|column==name){conn.execute(&format!("ALTER TABLE usage_sync_state ADD COLUMN {name} {declaration}"),[]).map_err(|e|e.to_string())?;}}
    conn.execute_batch(r#"
      CREATE TABLE IF NOT EXISTS opencode_accounts (id TEXT PRIMARY KEY,name TEXT NOT NULL,workspace_id TEXT NOT NULL DEFAULT 'Default',resolved_workspace_id TEXT,auth_cookie TEXT NOT NULL,show_rolling INTEGER NOT NULL DEFAULT 1,show_weekly INTEGER NOT NULL DEFAULT 1,show_monthly INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_records (usg_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES opencode_accounts(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL,created_at TEXT NOT NULL,model TEXT NOT NULL,provider TEXT,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cache_read_tokens INTEGER NOT NULL DEFAULT 0,cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,cost_raw INTEGER NOT NULL,cost_usd REAL NOT NULL,key_id TEXT,plan TEXT,synced_at TEXT NOT NULL,reasoning_tokens INTEGER NOT NULL DEFAULT 0,session_id TEXT,project_path TEXT,session_title TEXT);
      CREATE TABLE IF NOT EXISTS usage_sync_state (account_id TEXT PRIMARY KEY REFERENCES opencode_accounts(id) ON DELETE CASCADE,last_sync_at TEXT,last_sync_status TEXT,last_sync_error TEXT,last_inserted_count INTEGER NOT NULL DEFAULT 0,deepest_page_fetched INTEGER NOT NULL DEFAULT -1,total_records INTEGER NOT NULL DEFAULT 0,oldest_record_at TEXT,newest_record_at TEXT,last_success_at TEXT,last_failed_page INTEGER,last_parse_error_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS service_settings (id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quota_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL REFERENCES opencode_accounts(id) ON DELETE CASCADE,window_label TEXT NOT NULL,captured_at TEXT NOT NULL,used REAL NOT NULL,remaining REAL NOT NULL,total REAL NOT NULL,reset_at TEXT NOT NULL,reset_in_sec INTEGER NOT NULL,UNIQUE(account_id,window_label,captured_at));
      CREATE TABLE IF NOT EXISTS quota_weight_rules (id TEXT PRIMARY KEY,account_id TEXT REFERENCES opencode_accounts(id) ON DELETE CASCADE,plan TEXT,model_pattern TEXT NOT NULL DEFAULT '*',weight REAL NOT NULL CHECK(weight>0),effective_from TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'manual',sample_count INTEGER NOT NULL DEFAULT 0,confidence REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_contexts (account_id TEXT NOT NULL REFERENCES opencode_accounts(id) ON DELETE CASCADE,session_id TEXT NOT NULL,project_name TEXT,project_path TEXT,title TEXT,source TEXT NOT NULL DEFAULT 'manual',updated_at TEXT NOT NULL,PRIMARY KEY(account_id,session_id));
      CREATE INDEX IF NOT EXISTS idx_usage_account_time ON usage_records(account_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_account_key ON usage_records(account_id,key_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_session_time ON usage_records(account_id,session_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_time_model ON usage_records(created_at DESC,model,account_id);
      CREATE INDEX IF NOT EXISTS idx_usage_account_project_time ON usage_records(account_id,project_path,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_account_plan_model_time ON usage_records(account_id,plan,model,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_quota_snapshot_window_time ON quota_snapshots(account_id,window_label,captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_quota_weight_effective ON quota_weight_rules(account_id,plan,effective_from DESC);
      INSERT OR IGNORE INTO quota_weight_rules(id,model_pattern,weight,effective_from,source,created_at) VALUES('default','*',1,'1970-01-01T00:00:00Z','default','1970-01-01T00:00:00Z');
    "#).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(|e| e.to_string())?;
    Ok(())
}

fn default_settings() -> Value {
    json!({
        "refresh": {"opencode_go": {"auto_refresh": true, "interval_sec": 60}},
        "usage_sync": {"auto_sync": true, "interval_sec": 300, "backfill_pages_per_request": 100, "max_pages_per_incremental": 30},
        "timezone": "Asia/Shanghai",
        "feature_flags": features::defaults_minimal(),
        "feature_legacy_prompt_pending": false
    })
}

pub fn load_settings(path:&Path)->Value {
    let stored: Option<Value> = Connection::open(path).ok()
        .and_then(|conn| conn.query_row("SELECT payload FROM service_settings WHERE id=1", [], |row| row.get::<_, String>(0)).ok())
        .and_then(|text| serde_json::from_str(&text).ok());
    // A profile that predates feature flags gets full mode plus a one-time hint.
    let had_row = stored.is_some();
    let had_complete_flags = stored.as_ref()
        .and_then(|settings| settings.get("feature_flags"))
        .and_then(Value::as_object)
        .map(|flags| features::FEATURE_KEYS.iter().all(|key| flags.contains_key(*key)))
        .unwrap_or(false);
    let legacy_full = had_row && !had_complete_flags;
    let stored_settings = stored.unwrap_or_else(default_settings);
    let mut settings = default_settings();
    if legacy_full { settings["feature_flags"] = features::defaults_full(); }
    merge_json(&mut settings, &stored_settings);
    features::ensure_flags(&mut settings, legacy_full);
    if legacy_full { settings["feature_legacy_prompt_pending"] = json!(true); }
    if settings.get("feature_legacy_prompt_pending").is_none() { settings["feature_legacy_prompt_pending"] = json!(false); }
    settings
}

pub fn migrate_legacy_credentials(path:&Path)->Result<usize,String>{let conn=Connection::open(path).map_err(|e|e.to_string())?;let rows:Vec<(String,String)>=conn.prepare("SELECT id,auth_cookie FROM opencode_accounts WHERE auth_cookie LIKE 'enc:%'").map_err(|e|e.to_string())?.query_map([],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;let mut migrated=0;for(id,stored)in rows{if let Ok(secret)=crate::secrets::decrypt_electron(&stored){crate::secrets::set(&id,&secret)?;conn.execute("UPDATE opencode_accounts SET auth_cookie='keyring',updated_at=? WHERE id=?",params![now(),id]).map_err(|e|e.to_string())?;migrated+=1}}Ok(migrated)}

pub fn enabled_account_ids(path:&Path)->Result<Vec<String>,String>{let conn=Connection::open(path).map_err(|e|e.to_string())?;let mut statement=conn.prepare("SELECT id FROM opencode_accounts WHERE enabled=1 ORDER BY created_at").map_err(|e|e.to_string())?;let ids=statement.query_map([],|row|row.get(0)).map_err(|e|e.to_string())?.collect::<Result<_,_>>().map_err(|e|e.to_string())?;Ok(ids)}

fn account_view(row: Value) -> Value {
    let mut object = row.as_object().cloned().unwrap_or_default();
    let id=object.get("id").and_then(Value::as_str).unwrap_or_default();let stored=object.get("auth_cookie").and_then(Value::as_str).unwrap_or_default();
    let configured=if stored=="keyring"{crate::secrets::get(id).is_ok()}else{!stored.is_empty()&&!stored.starts_with("enc:")};
    let masked=if configured{"stored in system credential vault".to_string()}else{"".to_string()};
    object.remove("auth_cookie"); object.insert("configured".into(), json!(configured)); object.insert("auth_cookie_masked".into(), json!(masked));
    for key in ["show_rolling","show_weekly","show_monthly","enabled"] { if let Some(v)=object.get(key).and_then(Value::as_i64) { object.insert(key.into(), json!(v != 0)); } }
    Value::Object(object)
}

fn accounts(conn: &Connection) -> Result<Vec<Value>, String> {
    Ok(query_json(conn, "SELECT * FROM opencode_accounts ORDER BY created_at", &[])?.into_iter().map(account_view).collect())
}

fn config(state: &BackendState, conn: &Connection) -> Result<Value, String> {
    let settings = settings_snapshot(state)?;
    Ok(json!({"refresh":settings["refresh"],"usage_sync":settings["usage_sync"],"timezone":settings["timezone"],"feature_flags":settings["feature_flags"],"feature_legacy_prompt_pending":settings["feature_legacy_prompt_pending"],"accounts_imported":!accounts(conn)?.is_empty(),"opencode_accounts":accounts(conn)?}))
}

fn usage_select() -> &'static str { r#"ur.usg_id,ur.account_id,oa.name account_name,ur.created_at,ur.model,ur.provider,
 (ur.input_tokens+ur.cache_read_tokens+ur.cache_write_5m_tokens+ur.cache_write_1h_tokens) input_tokens,
 ur.output_tokens,ur.reasoning_tokens,ur.input_tokens uncached_input_tokens,ur.cache_read_tokens,
 (ur.cache_write_5m_tokens+ur.cache_write_1h_tokens) cache_write_tokens,ur.cost_usd,ur.key_id,ur.session_id,ur.project_path,ur.session_title,ur.plan"# }

fn list_usage(conn: &Connection, account: Option<&str>, offset: i64, limit: i64) -> Result<Value, String> {
    let (where_sql, args) = match account { Some(id)=>("WHERE ur.account_id=?",vec![json!(id)]),None=>("",vec![]) };
    let total = one(conn,&format!("SELECT COUNT(*) total FROM usage_records ur {where_sql}"),&args)?["total"].as_i64().unwrap_or(0);
    let mut page_args=args; page_args.push(json!(limit.clamp(1,200))); page_args.push(json!(offset.max(0)));
    let rows=query_json(conn,&format!("SELECT {} FROM usage_records ur JOIN opencode_accounts oa ON oa.id=ur.account_id {where_sql} ORDER BY ur.created_at DESC LIMIT ? OFFSET ?",usage_select()),&page_args)?;
    Ok(json!({"records":rows,"total":total,"offset":offset,"limit":limit}))
}

fn period_days(period: &str) -> i64 { match period { "today"=>1,"7d"=>7,"all"=>3650,_=>30 } }
fn daily_stats(conn:&Connection,days:i64,account:Option<&str>,timezone:&str)->Result<Vec<Value>,String>{
    let mut args=vec![json!(timezone),json!(period_start(days,timezone))]; let extra=if let Some(id)=account{args.push(json!(id));" AND account_id=?"}else{""};
    query_json(conn,&format!(r#"SELECT tz_date(created_at,?) date,ROUND(SUM(cost_usd),6) total_cost_usd,COUNT(*) request_count,SUM(input_tokens+cache_read_tokens+cache_write_5m_tokens+cache_write_1h_tokens) total_input_tokens,SUM(input_tokens) uncached_input_tokens,SUM(cache_read_tokens) cache_hit_tokens,SUM(cache_write_5m_tokens+cache_write_1h_tokens) cache_write_tokens,SUM(output_tokens) total_output_tokens,SUM(reasoning_tokens) total_reasoning_tokens FROM usage_records WHERE created_at>=?{extra} GROUP BY 1 ORDER BY 1 DESC"#),&args)
}

fn model_stats(conn:&Connection,days:i64,account:Option<&str>,timezone:&str)->Result<Vec<Value>,String>{
    let mut args=vec![json!(period_start(days,timezone))]; let extra=if let Some(id)=account{args.push(json!(id));" AND account_id=?"}else{""};
    query_json(conn,&format!(r#"SELECT model,SUM(input_tokens+cache_read_tokens+cache_write_5m_tokens+cache_write_1h_tokens) total_input_tokens,SUM(input_tokens) uncached_input_tokens,SUM(cache_read_tokens) cache_hit_tokens,SUM(cache_write_5m_tokens+cache_write_1h_tokens) cache_write_tokens,SUM(output_tokens) total_output_tokens,SUM(reasoning_tokens) total_reasoning_tokens,ROUND(SUM(cost_usd),6) total_cost_usd,COUNT(*) request_count FROM usage_records WHERE created_at>=?{extra} GROUP BY model ORDER BY total_cost_usd DESC"#),&args)
}

fn daily_model_stats(conn:&Connection,days:i64,account:Option<&str>,timezone:&str)->Result<Vec<Value>,String>{let mut args=vec![json!(timezone),json!(period_start(days,timezone))];let extra=if let Some(id)=account{args.push(json!(id));" AND account_id=?"}else{""};query_json(conn,&format!(r#"SELECT tz_date(created_at,?) date,model,ROUND(SUM(cost_usd),6) total_cost_usd,COUNT(*) request_count,SUM(input_tokens+cache_read_tokens+cache_write_5m_tokens+cache_write_1h_tokens) total_input_tokens,SUM(input_tokens) uncached_input_tokens,SUM(cache_read_tokens) cache_hit_tokens,SUM(cache_write_5m_tokens+cache_write_1h_tokens) cache_write_tokens,SUM(output_tokens) total_output_tokens,SUM(reasoning_tokens) total_reasoning_tokens FROM usage_records WHERE created_at>=?{extra} GROUP BY 1,model ORDER BY 1 DESC,total_cost_usd DESC"#),&args)}

fn hourly_stats(conn:&Connection,account:Option<&str>,timezone:&str)->Result<Vec<Value>,String>{let mut args=vec![json!(timezone)];let extra=if let Some(id)=account{args.push(json!(id));"WHERE account_id=?"}else{""};query_json(conn,&format!(r#"WITH RECURSIVE hours(h) AS (VALUES(0) UNION ALL SELECT h+1 FROM hours WHERE h<23), stats AS (SELECT CAST(tz_hour(created_at,?) AS INTEGER) h,SUM(cost_usd) cost,COUNT(*) requests,SUM(input_tokens+cache_read_tokens+cache_write_5m_tokens+cache_write_1h_tokens) inputs,SUM(input_tokens) uncached,SUM(cache_read_tokens) cache_hits,SUM(cache_write_5m_tokens+cache_write_1h_tokens) cache_writes,SUM(output_tokens) outputs,SUM(reasoning_tokens) reasoning FROM usage_records {extra} GROUP BY 1) SELECT printf('%02d:00',hours.h) date,ROUND(COALESCE(cost,0),6) total_cost_usd,COALESCE(requests,0) request_count,COALESCE(inputs,0) total_input_tokens,COALESCE(uncached,0) uncached_input_tokens,COALESCE(cache_hits,0) cache_hit_tokens,COALESCE(cache_writes,0) cache_write_tokens,COALESCE(outputs,0) total_output_tokens,COALESCE(reasoning,0) total_reasoning_tokens FROM hours LEFT JOIN stats ON stats.h=hours.h ORDER BY hours.h DESC"#),&args)}

fn quota_units(conn:&Connection,period:&str,account:Option<&str>,timezone:&str)->Result<Value,String>{let days=period_days(period);let mut args=vec![json!(period_start(days,timezone))];let extra=if let Some(id)=account{args.push(json!(id));" AND ur.account_id=?"}else{""};let models=query_json(conn,&format!(r#"SELECT ur.model,ROUND(SUM((ur.input_tokens+ur.output_tokens+ur.reasoning_tokens+ur.cache_read_tokens)*COALESCE((SELECT q.weight FROM quota_weight_rules q WHERE (q.account_id IS NULL OR q.account_id=ur.account_id) AND (q.plan IS NULL OR q.plan=ur.plan) AND (q.model_pattern='*' OR ur.model LIKE REPLACE(q.model_pattern,'*','%')) AND q.effective_from<=ur.created_at ORDER BY q.account_id IS NOT NULL DESC,q.effective_from DESC LIMIT 1),1))/1000000.0,6) quota_units,SUM(ur.input_tokens+ur.output_tokens+ur.reasoning_tokens+ur.cache_read_tokens) processed_tokens,COUNT(*) request_count FROM usage_records ur WHERE ur.created_at>=?{extra} GROUP BY ur.model ORDER BY quota_units DESC"#),&args)?;let total:f64=models.iter().map(|v|v["quota_units"].as_f64().unwrap_or(0.0)).sum();let requests:i64=models.iter().map(|v|v["request_count"].as_i64().unwrap_or(0)).sum();Ok(json!({"period":period,"total_quota_units":total,"request_count":requests,"models":models}))}

fn quota_intelligence(conn:&Connection,account:Option<&str>)->Result<Vec<Value>,String>{let mut args=vec![];let where_sql=if let Some(id)=account{args.push(json!(id));"WHERE qs.account_id=?"}else{""};let rows=query_json(conn,&format!("SELECT qs.*,a.name account_name FROM quota_snapshots qs JOIN opencode_accounts a ON a.id=qs.account_id {where_sql} ORDER BY qs.account_id,qs.window_label,qs.captured_at DESC"),&args)?;let mut groups:HashMap<String,Vec<Value>>=HashMap::new();for row in rows{groups.entry(format!("{}\0{}",row["account_id"].as_str().unwrap_or_default(),row["window_label"].as_str().unwrap_or_default())).or_default().push(row)}let mut out=vec![];for group in groups.values(){let latest=&group[0];let reset_hours=latest["reset_in_sec"].as_f64().unwrap_or(0.0)/3600.0;let mut rates=vec![];for pair in group.windows(2).take(20){let newer=&pair[0];let older=&pair[1];let t1=chrono::DateTime::parse_from_rfc3339(newer["captured_at"].as_str().unwrap_or("")).ok();let t0=chrono::DateTime::parse_from_rfc3339(older["captured_at"].as_str().unwrap_or("")).ok();if let(Some(t1),Some(t0))=(t1,t0){let hours=(t1-t0).num_seconds()as f64/3600.0;let delta=newer["used"].as_f64().unwrap_or(0.0)-older["used"].as_f64().unwrap_or(0.0);if hours>0.0&&delta>=0.0{rates.push(delta/hours)}}}rates.sort_by(f64::total_cmp);let rate=rates.get(rates.len()/2).copied();let remaining=latest["remaining"].as_f64().unwrap_or(0.0);let exhaust=rate.filter(|v|*v>0.0).map(|v|remaining/v);let samples=rates.len();let confidence=if samples>=8{"high"}else if samples>=4{"medium"}else if samples>=1{"low"}else{"insufficient"};let can=exhaust.map(|v|v>=reset_hours);let reserve=10.0;let safe_budget=((remaining-reserve).max(0.0)/(reset_hours/24.0).max(1.0)*100.0).round()/100.0;let projected=rate.map(|v|(remaining-v*reset_hours).max(0.0));let alert=if samples==0{"unknown"}else if can==Some(false)||remaining<=reserve{"critical"}else if remaining<=reserve*2.0{"warning"}else{"safe"};out.push(json!({"account_id":latest["account_id"],"account_name":latest["account_name"],"window_label":latest["window_label"],"captured_at":latest["captured_at"],"reset_at":latest["reset_at"],"remaining":remaining,"consumption_per_hour":rate,"hours_to_exhaust":exhaust,"hours_to_reset":reset_hours,"can_last_until_reset":can,"sample_count":samples,"confidence":confidence,"reserve_percent":reserve,"safe_budget_per_day":safe_budget,"projected_remaining_at_reset":projected,"acceleration_ratio":Value::Null,"alert_level":alert}));}out.sort_by(|a,b|a["remaining"].as_f64().unwrap_or(0.0).total_cmp(&b["remaining"].as_f64().unwrap_or(0.0)));Ok(out)}

fn recommendations(conn:&Connection,intelligence:&[Value])->Result<Value,String>{let best=intelligence.iter().filter(|v|v["remaining"].is_number()).max_by(|a,b|a["remaining"].as_f64().unwrap_or(0.0).total_cmp(&b["remaining"].as_f64().unwrap_or(0.0))).map(|v|json!({"account_id":v["account_id"],"name":v["account_name"],"bottleneck_remaining":v["remaining"],"reason_code":if v["alert_level"]=="critical"{"least_risk_among_critical"}else{"best_safe_headroom"},"confidence":v["confidence"]}));let rule=one(conn,"SELECT model_pattern model,weight FROM quota_weight_rules ORDER BY weight ASC,effective_from DESC LIMIT 1",&[])?;let model=if rule.is_null(){Value::Null}else{json!({"model":rule["model"],"weight":rule["weight"],"reason_code":"lowest_effective_quota_weight"})};Ok(json!({"account":best,"model":model,"generated_at":now()}))}

fn project_stats(conn:&Connection,account:Option<&str>)->Result<Vec<Value>,String>{let mut args=vec![];let where_sql=if let Some(id)=account{args.push(json!(id));"WHERE ur.account_id=?"}else{""};let rows=query_json(conn,&format!(r#"SELECT COALESCE(NULLIF(ur.project_path,''),'Unassigned') project_name,NULLIF(ur.project_path,'') project_path,ur.model,COUNT(*) request_count,COUNT(DISTINCT NULLIF(ur.session_id,'')) session_count,SUM(ur.cost_usd) total_cost_usd,SUM(ur.input_tokens+ur.output_tokens+ur.reasoning_tokens+ur.cache_read_tokens+ur.cache_write_5m_tokens+ur.cache_write_1h_tokens) total_tokens,SUM(ur.cache_read_tokens) cache_read_tokens,SUM(ur.input_tokens+ur.cache_read_tokens+ur.cache_write_5m_tokens+ur.cache_write_1h_tokens) total_input_tokens FROM usage_records ur {where_sql} GROUP BY 1,2,ur.model ORDER BY total_cost_usd DESC"#),&args)?;let mut projects:HashMap<String,Value>=HashMap::new();for row in rows{let key=format!("{}\0{}",row["project_name"].as_str().unwrap_or("Unassigned"),row["project_path"].as_str().unwrap_or(""));let project=projects.entry(key).or_insert_with(||json!({"project_name":row["project_name"],"project_path":row["project_path"],"request_count":0,"session_count":0,"total_cost_usd":0.0,"total_tokens":0,"cache_read_tokens":0,"total_input_tokens":0,"cache_hit_rate":0.0,"models":[]}));for field in ["request_count","session_count","total_tokens","cache_read_tokens","total_input_tokens"]{project[field]=json!(project[field].as_i64().unwrap_or(0)+row[field].as_i64().unwrap_or(0));}project["total_cost_usd"]=json!(project["total_cost_usd"].as_f64().unwrap_or(0.0)+row["total_cost_usd"].as_f64().unwrap_or(0.0));project["models"].as_array_mut().unwrap().push(json!({"model":row["model"],"request_count":row["request_count"],"total_tokens":row["total_tokens"],"total_cost_usd":row["total_cost_usd"]}));}let mut out:Vec<Value>=projects.into_values().map(|mut p|{p["cache_hit_rate"]=json!(if p["total_input_tokens"].as_f64().unwrap_or(0.0)>0.0{(p["cache_read_tokens"].as_f64().unwrap_or(0.0)/p["total_input_tokens"].as_f64().unwrap_or(1.0)*1000.0).round()/10.0}else{0.0});p}).collect();out.sort_by(|a,b|b["total_cost_usd"].as_f64().unwrap_or(0.0).total_cmp(&a["total_cost_usd"].as_f64().unwrap_or(0.0)));Ok(out)}

fn reconciliation(conn:&Connection,account:Option<&str>)->Result<Vec<Value>,String>{let mut args=vec![];let filter=if let Some(id)=account{args.push(json!(id));"WHERE account_id=?"}else{""};let rows=query_json(conn,&format!(r#"WITH ordered AS (SELECT qs.*,LAG(captured_at) OVER w previous_captured_at,LAG(used) OVER w previous_used,LAG(remaining) OVER w previous_remaining,LAG(total) OVER w previous_total,LAG(reset_at) OVER w previous_reset_at FROM quota_snapshots qs {filter} WINDOW w AS (PARTITION BY account_id,window_label ORDER BY captured_at)) SELECT ordered.*,a.name account_name,(SELECT COUNT(*) FROM usage_records ur WHERE ur.account_id=ordered.account_id AND ur.created_at>ordered.previous_captured_at AND ur.created_at<=ordered.captured_at) local_request_count,(SELECT COALESCE(SUM(input_tokens+output_tokens+reasoning_tokens),0) FROM usage_records ur WHERE ur.account_id=ordered.account_id AND ur.created_at>ordered.previous_captured_at AND ur.created_at<=ordered.captured_at) local_tokens FROM ordered JOIN opencode_accounts a ON a.id=ordered.account_id WHERE previous_captured_at IS NOT NULL ORDER BY captured_at DESC LIMIT 5000"#),&args)?;Ok(rows.into_iter().map(|r|{let used=r["used"].as_f64().unwrap_or(0.0)-r["previous_used"].as_f64().unwrap_or(0.0);let remaining=r["remaining"].as_f64().unwrap_or(0.0)-r["previous_remaining"].as_f64().unwrap_or(0.0);let from=chrono::DateTime::parse_from_rfc3339(r["previous_captured_at"].as_str().unwrap_or("")).ok();let to=chrono::DateTime::parse_from_rfc3339(r["captured_at"].as_str().unwrap_or("")).ok();let hours=from.zip(to).map(|(a,b)|(b-a).num_seconds()as f64/3600.0).unwrap_or(0.0);let reset=r["reset_at"]!=r["previous_reset_at"];let total=r["total"]!=r["previous_total"];let requests=r["local_request_count"].as_i64().unwrap_or(0);let gap=if r["window_label"].as_str().unwrap_or("").contains("5h"){12.0}else{48.0};let kind=if total{"rule_change"}else if reset||used < -20.0{"reset"}else if remaining>5.0&&used<=0.0{"top_up"}else if hours>gap{"snapshot_gap"}else if used>0.5&&requests==0{"missing_local_usage"}else{"matched"};json!({"account_id":r["account_id"],"account_name":r["account_name"],"window_label":r["window_label"],"from":r["previous_captured_at"],"to":r["captured_at"],"event_type":kind,"official_used_delta":(used*100.0).round()/100.0,"official_remaining_delta":(remaining*100.0).round()/100.0,"local_request_count":requests,"local_tokens":r["local_tokens"],"elapsed_hours":(hours*10.0).round()/10.0,"excluded_from_calibration":kind!="matched"})}).collect())}

fn auto_calibrate(conn:&Connection,account:Option<&str>)->Result<Vec<Value>,String>{let mut args=vec![];let filter=if let Some(id)=account{args.push(json!(id));"WHERE account_id=?"}else{""};let intervals=query_json(conn,&format!(r#"WITH ordered AS (SELECT *,LAG(captured_at) OVER w previous_captured_at,LAG(used) OVER w previous_used,LAG(total) OVER w previous_total,LAG(reset_at) OVER w previous_reset_at FROM quota_snapshots {filter} WINDOW w AS(PARTITION BY account_id,window_label ORDER BY captured_at)) SELECT * FROM ordered WHERE previous_captured_at IS NOT NULL ORDER BY captured_at"#),&args)?;let mut samples:HashMap<String,Vec<(f64,String,String,String)>>=HashMap::new();for interval in intervals{let delta=interval["used"].as_f64().unwrap_or(0.0)-interval["previous_used"].as_f64().unwrap_or(0.0);if interval["reset_at"]!=interval["previous_reset_at"]||interval["total"]!=interval["previous_total"]||delta<=0.0||delta>50.0{continue}let model_rows=query_json(conn,"SELECT model,COALESCE(plan,'') plan,SUM(input_tokens+output_tokens+reasoning_tokens+cache_read_tokens+cache_write_5m_tokens+cache_write_1h_tokens) tokens FROM usage_records WHERE account_id=? AND created_at>? AND created_at<=? GROUP BY model,plan ORDER BY tokens DESC",&[interval["account_id"].clone(),interval["previous_captured_at"].clone(),interval["captured_at"].clone()])?;let total:i64=model_rows.iter().map(|v|v["tokens"].as_i64().unwrap_or(0)).sum();let Some(dominant)=model_rows.first()else{continue};if total<=0||dominant["tokens"].as_f64().unwrap_or(0.0)/(total as f64)<0.8{continue}let weight=delta/(total as f64/1_000_000.0);if !weight.is_finite()||weight<=0.0{continue}let account=interval["account_id"].as_str().unwrap_or_default().to_string();let plan=dominant["plan"].as_str().unwrap_or_default().to_string();let model=dominant["model"].as_str().unwrap_or_default().to_string();samples.entry(format!("{account}\0{plan}\0{model}")).or_default().push((weight,interval["captured_at"].as_str().unwrap_or_default().to_string(),account,plan));}let mut created=vec![];for(key,group)in samples{if group.len()<2{continue}let model=key.rsplit('\0').next().unwrap_or("*");let mut weights:Vec<f64>=group.iter().map(|v|v.0).collect();weights.sort_by(f64::total_cmp);let weight=weights[weights.len()/2].clamp(0.05,1000.0);let latest=group.iter().map(|v|v.1.as_str()).max().unwrap_or(&group[0].1);let id=Uuid::new_v4().to_string();let confidence=(group.len()as f64/6.0).min(1.0)*0.8;conn.execute("INSERT INTO quota_weight_rules(id,account_id,plan,model_pattern,weight,effective_from,source,sample_count,confidence,created_at) VALUES(?,?,?,?,?,?,'auto',?,?,?)",params![id,group[0].2,if group[0].3.is_empty(){None}else{Some(group[0].3.as_str())},model,weight,latest,group.len()as i64,confidence,now()]).map_err(|e|e.to_string())?;created.push(one(conn,"SELECT * FROM quota_weight_rules WHERE id=?",&[json!(id)])?);}Ok(created)}

fn health(conn:&Connection)->Result<Vec<Value>,String>{query_json(conn,r#"SELECT s.account_id,a.name account_name,s.last_sync_at,s.last_sync_status,s.last_sync_error,s.last_success_at,s.last_failed_page,s.last_parse_error_count,(s.last_sync_status='ok' AND s.last_parse_error_count=0) healthy,s.last_inserted_count,s.deepest_page_fetched,s.total_records,s.oldest_record_at,s.newest_record_at FROM usage_sync_state s JOIN opencode_accounts a ON a.id=s.account_id WHERE a.enabled=1 ORDER BY a.created_at"#,&[])}

fn quota_accounts(conn:&Connection)->Result<Vec<QuotaAccount>,String>{Ok(query_json(conn,"SELECT id,name,workspace_id,auth_cookie,show_rolling,show_weekly,show_monthly FROM opencode_accounts WHERE enabled=1 ORDER BY created_at",&[])?.into_iter().map(|v|{let id=v["id"].as_str().unwrap_or_default().to_string();let stored=v["auth_cookie"].as_str().unwrap_or_default();let secret=if stored=="keyring"{crate::secrets::get(&id).unwrap_or_default()}else if stored.starts_with("enc:"){String::new()}else{stored.to_string()};QuotaAccount{id,name:v["name"].as_str().unwrap_or_default().into(),workspace_id:v["workspace_id"].as_str().unwrap_or("Default").into(),auth_cookie:secret,show_rolling:v["show_rolling"].as_i64().unwrap_or(1)!=0,show_weekly:v["show_weekly"].as_i64().unwrap_or(1)!=0,show_monthly:v["show_monthly"].as_i64().unwrap_or(1)!=0}}).collect())}

fn save_quota(conn:&mut Connection, rows:&[Value])->Result<(),String>{let tx=conn.transaction().map_err(|e|e.to_string())?;for account in rows.iter().filter(|v|v["success"].as_bool()==Some(true)){for window in account["windows"].as_array().into_iter().flatten(){tx.execute("INSERT OR IGNORE INTO quota_snapshots(account_id,window_label,captured_at,used,remaining,total,reset_at,reset_in_sec) VALUES(?,?,?,?,?,?,?,?)",params![account["account_id"].as_str(),window["label"].as_str(),account["updated_at"].as_str(),window["used"].as_f64(),window["remaining"].as_f64(),window["total"].as_f64(),window["reset_at"].as_str(),window["reset_in_sec"].as_i64()]).map_err(|e|e.to_string())?;}}tx.commit().map_err(|e|e.to_string())}

fn aggregate_quota(rows:&[Value])->Value{let mut accounts_out=vec![];let mut values=vec![];for account in rows{let windows=account["windows"].as_array().cloned().unwrap_or_default();let bottleneck=windows.iter().min_by(|a,b|a["remaining"].as_f64().unwrap_or(0.0).total_cmp(&b["remaining"].as_f64().unwrap_or(0.0)));let remaining=bottleneck.and_then(|v|v["remaining"].as_f64()).unwrap_or(0.0);if account["success"].as_bool()==Some(true){values.push(remaining)}accounts_out.push(json!({"account_id":account["account_id"],"name":account["name"],"success":account["success"],"effective_remaining":remaining,"blocked":remaining<=0.0&&account["success"].as_bool()==Some(true),"windows":windows,"bottleneck_window":bottleneck.map(|v|v["label"].clone()).unwrap_or(Value::Null),"bottleneck_remaining":bottleneck.map(|v|v["remaining"].clone()).unwrap_or(Value::Null)}));}let avg=if values.is_empty(){0.0}else{values.iter().sum::<f64>()/values.len() as f64};let bottleneck=accounts_out.iter().filter(|v|v["success"].as_bool()==Some(true)).min_by(|a,b|a["bottleneck_remaining"].as_f64().unwrap_or(101.0).total_cmp(&b["bottleneck_remaining"].as_f64().unwrap_or(101.0))).map(|v|json!({"account_id":v["account_id"],"name":v["name"],"window":v["bottleneck_window"],"remaining":v["bottleneck_remaining"]}));json!({"avg_effective_remaining":(avg*10.0).round()/10.0,"account_count":rows.len(),"success_count":values.len(),"blocked_count":accounts_out.iter().filter(|v|v["blocked"].as_bool()==Some(true)).count(),"accounts":accounts_out,"bottleneck":bottleneck})}

async fn fetch_quotas(state:&BackendState)->Result<Vec<Value>,String>{let conn=Connection::open(&state.db_path).map_err(|e|e.to_string())?;let accounts=quota_accounts(&conn)?;drop(conn);let rows=quota::fetch_all(accounts).await;let mut conn=Connection::open(&state.db_path).map_err(|e|e.to_string())?;save_quota(&mut conn,&rows)?;let _=auto_calibrate(&conn,None);Ok(rows)}

/// Rebuilds the latest quota view from persisted snapshots without any network I/O.
fn cached_quota(conn:&Connection)->Result<Vec<Value>,String>{
    let account_rows=query_json(conn,"SELECT id,name,workspace_id FROM opencode_accounts WHERE enabled=1 ORDER BY created_at",&[])?;
    let snapshots=query_json(conn,r#"SELECT qs.* FROM quota_snapshots qs WHERE qs.captured_at=(SELECT MAX(q2.captured_at) FROM quota_snapshots q2 WHERE q2.account_id=qs.account_id AND q2.window_label=qs.window_label)"#,&[])?;
    let mut windows_by_account:HashMap<String,Vec<Value>>=HashMap::new();
    let mut updated_by_account:HashMap<String,String>=HashMap::new();
    for row in snapshots{
        let account=row["account_id"].as_str().unwrap_or_default().to_string();
        let captured=row["captured_at"].as_str().unwrap_or_default().to_string();
        windows_by_account.entry(account.clone()).or_default().push(json!({
            "label":row["window_label"],"used":row["used"],"remaining":row["remaining"],"total":row["total"],
            "reset_at":row["reset_at"],"reset_in_sec":row["reset_in_sec"]
        }));
        if !captured.is_empty(){updated_by_account.insert(account,captured);}
    }
    Ok(account_rows.into_iter().map(|account|{
        let id=account["id"].as_str().unwrap_or_default();
        let windows=windows_by_account.remove(id).unwrap_or_default();
        json!({"account_id":id,"name":account["name"],"workspace_id":account["workspace_id"],"success":!windows.is_empty(),"updated_at":updated_by_account.get(id).cloned().unwrap_or_default(),"windows":windows})
    }).collect())
}

fn quota_refresh_interval(state:&BackendState)->u64{
    settings_snapshot(state).ok().and_then(|settings|settings["refresh"]["opencode_go"]["interval_sec"].as_u64()).unwrap_or(60).clamp(30,3600)
}

/// Starts one non-blocking quota refresh when the cache is missing or the
/// configured interval has elapsed. Dashboard reads `cached_quota` and stays
/// fast even when the OpenCode endpoint is slow.
pub fn ensure_quota_refresh(state:&BackendState,conn:&Connection)->Result<(),String>{
    let enabled=one(conn,"SELECT COUNT(*) count FROM opencode_accounts WHERE enabled=1",&[])?["count"].as_i64().unwrap_or(0);
    if enabled==0{return Ok(())}
    let missing=one(conn,r#"SELECT COUNT(*) count FROM opencode_accounts a LEFT JOIN quota_snapshots qs ON qs.account_id=a.id WHERE a.enabled=1 AND qs.account_id IS NULL"#,&[])?["count"].as_i64().unwrap_or(0);
    let mut running=state.quota_refresh_running.lock().map_err(|_|"quota refresh lock poisoned")?;
    if *running{return Ok(())}
    let last=*state.quota_last_refresh.lock().map_err(|_|"quota refresh lock poisoned")?;
    let interval=quota_refresh_interval(state);
    let due=missing>0||last.map(|time|time.elapsed()>=std::time::Duration::from_secs(interval)).unwrap_or(true);
    if !due{return Ok(())}
    *running=true;
    drop(running);
    let state=state.clone();
    tauri::async_runtime::spawn(async move{
        let _=fetch_quotas(&state).await;
        if let Ok(mut guard)=state.quota_refresh_running.lock(){*guard=false;}
        if let Ok(mut guard)=state.quota_last_refresh.lock(){*guard=Some(Instant::now());}
    });
    Ok(())
}

async fn route(state:&BackendState, request:&ApiRequest)->Result<Value,String>{
    let url=Url::parse(&format!("ipc://local{}",request.path)).map_err(|e|e.to_string())?; let path=url.path();
    let qp=|name:&str|url.query_pairs().find(|(k,_)|k==name).map(|(_,v)|v.into_owned());
    if request.method=="POST"&&path=="/data/restore"{require_feature(state, DATA_TOOLS)?;let encoded=request.body.as_ref().and_then(|v|v["base64"].as_str()).ok_or("backup payload required")?;let bytes=BASE64.decode(encoded).map_err(|e|e.to_string())?;if bytes.len()<16||&bytes[..16]!=b"SQLite format 3\0"{return Err("invalid SQLite backup".into())}let candidate=state.db_path.with_extension("restore.db");fs::write(&candidate,&bytes).map_err(|e|e.to_string())?;let check=Connection::open(&candidate).map_err(|e|e.to_string())?;let integrity:String=check.query_row("PRAGMA integrity_check",[],|r|r.get(0)).map_err(|e|e.to_string())?;let version:i64=check.query_row("PRAGMA user_version",[],|r|r.get(0)).map_err(|e|e.to_string())?;drop(check);if integrity!="ok"||version>SCHEMA_VERSION{let _=fs::remove_file(&candidate);return Err("backup integrity or schema validation failed".into())}fs::copy(&state.db_path,state.db_path.with_extension("before-restore.db")).map_err(|e|e.to_string())?;fs::copy(&candidate,&state.db_path).map_err(|e|e.to_string())?;fs::remove_file(candidate).map_err(|e|e.to_string())?;return Ok(json!({"ok":true,"schema_version":version}))}
    let conn=Connection::open(&state.db_path).map_err(|e|e.to_string())?; conn.pragma_update(None,"foreign_keys","ON").map_err(|e|e.to_string())?;configure_connection(&conn)?;
    let timezone=timezone_name(state);
    let parts:Vec<&str>=path.trim_matches('/').split('/').collect();
    if request.method=="GET"&&path=="/usage/sessions" {
        require_feature(state, USAGE_RECORDS)?;
        let account=qp("account_id");
        let mut args=vec![];
        let where_sql=if let Some(id)=account{args.push(json!(id));"WHERE ur.account_id=?"}else{""};
        let total_sql=format!("SELECT COUNT(*) total FROM (SELECT 1 FROM usage_records ur {where_sql} GROUP BY ur.account_id,ur.session_id)");
        let total=one(&conn,&total_sql,&args)?["total"].as_i64().unwrap_or(0);
        let limit=qp("limit").and_then(|v|v.parse::<i64>().ok()).unwrap_or(50).clamp(1,200);
        let offset=qp("offset").and_then(|v|v.parse::<i64>().ok()).unwrap_or(0).max(0);
        let sql=format!(r#"SELECT ur.account_id,oa.name account_name,NULLIF(ur.session_id,'') session_id,MAX(NULLIF(ur.project_path,'')) project_name,MAX(NULLIF(ur.project_path,'')) project_path,MAX(NULLIF(ur.session_title,'')) session_title,COUNT(*) request_count,SUM(ur.input_tokens) total_input_tokens,SUM(ur.output_tokens) total_output_tokens,SUM(ur.reasoning_tokens) total_reasoning_tokens,SUM(ur.cache_read_tokens) total_cache_read_tokens,SUM(ur.cost_usd) total_cost_usd,MIN(ur.created_at) first_at,MAX(ur.created_at) last_at FROM usage_records ur JOIN opencode_accounts oa ON oa.id=ur.account_id {where_sql} GROUP BY ur.account_id,oa.name,ur.session_id ORDER BY last_at DESC LIMIT ? OFFSET ?"#);
        args.push(json!(limit));args.push(json!(offset));
        return Ok(json!({"total":total,"sessions":query_json(&conn,&sql,&args)?,"offset":offset,"limit":limit}));
    }
    if request.method=="POST"&&parts.len()>=5&&parts[0]=="accounts"&&parts[1]=="opencode"&&parts[3]=="usage"&&(parts[4]=="sync"||parts[4]=="backfill"){
        if parts[4]=="backfill" { require_feature(state, ADVANCED_SYNC)?; }
        let id=parts[2].to_string();
        let (max,stop_at)=if parts[4]=="sync"{(30,None)}else{match qp("mode").as_deref().unwrap_or("days"){
            "all"=>(10_000,None),
            "until"=>{let value=qp("until").ok_or("until is required")?;let date=NaiveDate::parse_from_str(&value,"%Y-%m-%d").map_err(|_|"until must use YYYY-MM-DD")?;(10_000,Some(format!("{}T00:00:00Z",date.format("%Y-%m-%d"))))},
            "days"=>{let days=qp("days").and_then(|v|v.parse::<i64>().ok()).unwrap_or(90).clamp(1,3650);(10_000,Some((Utc::now()-Duration::days(days)).to_rfc3339_opts(SecondsFormat::Secs,true)))},
            _=>return Err("unknown backfill mode".into())
        }};
        drop(conn);return crate::usage::sync(&state.db_path,&id,max,stop_at.as_deref()).await
    }
    if parts.len()==4&&parts[0]=="accounts"&&parts[1]=="opencode"&&(parts[3]=="test"||parts[3]=="quota") {let id=parts[2];let rows=quota_accounts(&conn)?;let Some(account)=rows.into_iter().find(|a|a.id==id)else{return Err("account not found".into())};drop(conn);let value=quota::fetch(account,0).await;if parts[3]=="test"{return Ok(if value["success"].as_bool()==Some(true){json!({"success":true,"workspace_id":value["workspace_id"]})}else{json!({"success":false,"error":value["error"]})})}return Ok(value)}
    match (request.method.as_str(),path) {
      ("GET","/health")=>Ok(json!({"status":"ok","transport":"tauri-ipc"})),
      ("GET","/config")=>config(state,&conn),
      ("PUT","/config")=>{let body=request.body.clone().unwrap_or(json!({}));features::validate_patch(&body)?;if let Some(value)=body["timezone"].as_str(){value.parse::<Tz>().map_err(|_|"invalid IANA timezone")?;}let mut guard=state.settings.lock().map_err(|_|"settings lock poisoned")?;merge_json(&mut guard,&body);features::ensure_flags(&mut guard,false);conn.execute("INSERT INTO service_settings(id,payload,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",params![guard.to_string(),now()]).map_err(|e|e.to_string())?;drop(guard);config(state,&conn)},
      ("GET","/accounts/opencode")=>Ok(Value::Array(accounts(&conn)?)),
      ("POST","/accounts/opencode")=>{let b=request.body.as_ref().ok_or("request body required")?;let id=Uuid::new_v4().to_string();let timestamp=now();crate::secrets::set(&id,b["auth_cookie"].as_str().unwrap_or(""))?;if let Err(error)=conn.execute("INSERT INTO opencode_accounts(id,name,workspace_id,auth_cookie,show_rolling,show_weekly,show_monthly,enabled,created_at,updated_at) VALUES(?,?,?,'keyring',1,1,1,1,?,?)",params![id,b["name"].as_str().unwrap_or("Account"),b["workspace_id"].as_str().unwrap_or("Default"),timestamp,timestamp]){crate::secrets::remove(&id);return Err(error.to_string())}conn.execute("INSERT INTO usage_sync_state(account_id) VALUES(?)",params![id]).map_err(|e|e.to_string())?;Ok(account_view(one(&conn,"SELECT * FROM opencode_accounts WHERE id=?",&[json!(id)])?))},
      ("GET","/usage/all")=>{require_feature(state, USAGE_RECORDS)?;list_usage(&conn,qp("account_id").as_deref(),qp("offset").and_then(|v|v.parse().ok()).unwrap_or(0),qp("limit").and_then(|v|v.parse().ok()).unwrap_or(50))},
      ("GET","/health/data")=>Ok(json!({"accounts":health(&conn)?})),
      ("GET","/analytics/opencode/daily")=>{require_feature(state, TOKEN_STATS)?;let days=qp("days").and_then(|v|v.parse().ok()).unwrap_or(30);Ok(json!({"days":days,"timezone":timezone,"stats":daily_stats(&conn,days,qp("account_id").as_deref(),&timezone)?}))},
      ("GET","/analytics/opencode/model-tokens")=>{let days=qp("period").map(|p|period_days(&p)).or_else(||qp("days").and_then(|v|v.parse().ok())).unwrap_or(30);Ok(json!({"days":days,"timezone":timezone,"stats":model_stats(&conn,days,qp("account_id").as_deref(),&timezone)?}))},
      ("GET","/analytics/opencode/daily/models")=>{require_feature(state, TOKEN_STATS)?;let days=qp("days").and_then(|v|v.parse().ok()).unwrap_or(30);Ok(json!({"days":days,"timezone":timezone,"stats":daily_model_stats(&conn,days,qp("account_id").as_deref(),&timezone)?}))},
      ("GET","/analytics/opencode/hourly")=>{require_feature(state, TOKEN_STATS)?;Ok(json!({"hours":24,"timezone":timezone,"stats":hourly_stats(&conn,qp("account_id").as_deref(),&timezone)?}))},
      ("GET","/analytics/opencode/projects")=>{require_feature(state, USAGE_RECORDS)?;Ok(json!({"projects":project_stats(&conn,qp("account_id").as_deref())?}))},
      ("GET","/quota/snapshots")=>{require_feature(state, QUOTA_INTELLIGENCE)?;let limit=qp("limit").and_then(|v|v.parse::<i64>().ok()).unwrap_or(500).clamp(1,2000);let mut clauses=vec![];let mut args=vec![];if let Some(id)=qp("account_id"){clauses.push("account_id=?");args.push(json!(id));}if let Some(label)=qp("window_label"){clauses.push("window_label=?");args.push(json!(label));}let where_sql=if clauses.is_empty(){"".into()}else{format!("WHERE {}",clauses.join(" AND "))};args.push(json!(limit));Ok(json!({"snapshots":query_json(&conn,&format!("SELECT * FROM quota_snapshots {where_sql} ORDER BY captured_at DESC LIMIT ?"),&args)?}))},
      ("GET","/quota/weights")=>{require_feature(state, QUOTA_INTELLIGENCE)?;Ok(json!({"rules":query_json(&conn,"SELECT * FROM quota_weight_rules ORDER BY effective_from DESC",&[])?}))},
      ("POST","/quota/weights")=>{require_feature(state, QUOTA_INTELLIGENCE)?;let b=request.body.as_ref().ok_or("request body required")?;let id=Uuid::new_v4().to_string();conn.execute("INSERT INTO quota_weight_rules(id,account_id,plan,model_pattern,weight,effective_from,source,created_at) VALUES(?,?,?,?,?,?,'manual',?)",params![id,b["account_id"].as_str(),b["plan"].as_str(),b["model_pattern"].as_str().unwrap_or("*"),b["weight"].as_f64().unwrap_or(1.0),b["effective_from"].as_str().unwrap_or(&now()),now()]).map_err(|e|e.to_string())?;one(&conn,"SELECT * FROM quota_weight_rules WHERE id=?",&[json!(id)])},
      ("GET","/quota")=>{ensure_quota_refresh(state,&conn)?;Ok(Value::Array(cached_quota(&conn)?))},
      ("GET","/quota/intelligence")=>{require_feature(state, QUOTA_INTELLIGENCE)?;Ok(json!({"windows":quota_intelligence(&conn,qp("account_id").as_deref())?}))},
      ("GET","/quota/reconciliation")=>{require_feature(state, QUOTA_INTELLIGENCE)?;Ok(json!({"events":reconciliation(&conn,qp("account_id").as_deref())?}))},
      ("GET","/quota/units")=>{require_feature(state, QUOTA_INTELLIGENCE)?;quota_units(&conn,qp("period").as_deref().unwrap_or("30d"),qp("account_id").as_deref(),&timezone)},
      ("GET","/recommendations")=>{require_feature(state, QUOTA_INTELLIGENCE)?;let intel=quota_intelligence(&conn,None)?;recommendations(&conn,&intel)},
      ("POST","/quota/weights/calibrate")=>{require_feature(state, QUOTA_INTELLIGENCE)?;Ok(json!({"created":auto_calibrate(&conn,qp("account_id").as_deref())?}))},
      ("GET","/dashboard")=>{let period=qp("period").unwrap_or_else(||"30d".into());ensure_quota_refresh(state,&conn)?;let quota=cached_quota(&conn)?;let days=period_days(&period);let recent=list_usage(&conn,None,0,10)?;let model=model_stats(&conn,days,None,&timezone)?;let smart=feature_enabled(state,QUOTA_INTELLIGENCE)?;let intel=if smart{quota_intelligence(&conn,None)?}else{Vec::new()};let reconciliation_events=if smart{reconciliation(&conn,None)?.into_iter().take(50).collect::<Vec<_>>()}else{Vec::new()};let recommendations=if smart{recommendations(&conn,&intel)?}else{Value::Null};Ok(json!({"overview":{"opencode":aggregate_quota(&quota)},"quota":quota,"recent_usage":{"records":recent["records"],"total":recent["total"]},"model_tokens":model,"data_health":health(&conn)?,"quota_intelligence":intel,"quota_reconciliation":reconciliation_events,"quota_units":Value::Null,"recommendations":recommendations,"period":period,"timezone":timezone}))},
      ("GET","/analytics/overview")=>{ensure_quota_refresh(state,&conn)?;Ok(json!({"opencode":aggregate_quota(&cached_quota(&conn)?)}))},
      ("GET","/data/backup")=>{require_feature(state, DATA_TOOLS)?;conn.execute_batch("PRAGMA wal_checkpoint(FULL)").map_err(|e|e.to_string())?;drop(conn);let bytes=fs::read(&state.db_path).map_err(|e|e.to_string())?;Ok(json!({"base64":BASE64.encode(bytes),"mime":"application/x-sqlite3","filename":"opencodegoboard-backup.db"}))},
      ("GET","/data/diagnostics")=>{require_feature(state, DATA_TOOLS)?;let report=json!({"format":"opencodegoboard-diagnostics","format_version":1,"generated_at":now(),"runtime":{"platform":std::env::consts::OS,"arch":std::env::consts::ARCH,"transport":"tauri-ipc"},"database":{"schema_version":SCHEMA_VERSION,"counts":{"accounts":one(&conn,"SELECT COUNT(*) count FROM opencode_accounts",&[])?["count"],"usage_records":one(&conn,"SELECT COUNT(*) count FROM usage_records",&[])?["count"],"quota_snapshots":one(&conn,"SELECT COUNT(*) count FROM quota_snapshots",&[])?["count"]}},"data_health":health(&conn)?});let bytes=serde_json::to_vec_pretty(&report).map_err(|e|e.to_string())?;Ok(json!({"base64":BASE64.encode(bytes),"mime":"application/json","filename":"opencodegoboard-diagnostics.json"}))},
      ("GET","/data/export.csv")=>{require_feature(state, DATA_TOOLS)?;let rows=query_json(&conn,&format!("SELECT {} FROM usage_records ur JOIN opencode_accounts oa ON oa.id=ur.account_id ORDER BY ur.created_at DESC",usage_select()),&[])?;let mut csv=String::from("usg_id,account_name,created_at,model,input_tokens,output_tokens,reasoning_tokens,cost_usd,session_id,project_path\n");for row in rows{let fields=["usg_id","account_name","created_at","model","input_tokens","output_tokens","reasoning_tokens","cost_usd","session_id","project_path"].map(|key|format!("\"{}\"",row[key].as_str().map(str::to_string).unwrap_or_else(||row[key].to_string()).replace('"',"\"\"")));csv.push_str(&fields.join(","));csv.push('\n');}Ok(json!({"base64":BASE64.encode(csv.as_bytes()),"mime":"text/csv;charset=utf-8","filename":"opencodegoboard-usage.csv"}))},
      _=>dynamic_route(state,&conn,request,path,&url),
    }
}

fn merge_json(target:&mut Value,patch:&Value){if let(Value::Object(to),Value::Object(from))=(target,patch){for(k,v)in from{if v.is_object(){merge_json(to.entry(k).or_insert(json!({})),v)}else{to.insert(k.clone(),v.clone());}}}}

fn dynamic_route(state:&BackendState,conn:&Connection,request:&ApiRequest,path:&str,url:&Url)->Result<Value,String>{
    let segments:Vec<&str>=path.trim_matches('/').split('/').collect();let qp=|name:&str|url.query_pairs().find(|(k,_)|k==name).map(|(_,v)|v.into_owned());
    if segments.len()>=3&&segments[0]=="accounts"&&segments[1]=="opencode"{let id=segments[2];
      if segments.len()==3&&request.method=="DELETE"{crate::secrets::remove(id);return Ok(json!({"ok":conn.execute("DELETE FROM opencode_accounts WHERE id=?",params![id]).map_err(|e|e.to_string())?>0}));}
      if segments.len()==3&&request.method=="PUT"{let body=request.body.as_ref().ok_or("request body required")?;for key in ["name","workspace_id"]{if let Some(v)=body.get(key).and_then(Value::as_str){conn.execute(&format!("UPDATE opencode_accounts SET {key}=?,updated_at=? WHERE id=?"),params![v,now(),id]).map_err(|e|e.to_string())?;}}if let Some(secret)=body.get("auth_cookie").and_then(Value::as_str){crate::secrets::set(id,secret)?;conn.execute("UPDATE opencode_accounts SET auth_cookie='keyring',updated_at=? WHERE id=?",params![now(),id]).map_err(|e|e.to_string())?;}for key in ["show_rolling","show_weekly","show_monthly","enabled"]{if let Some(v)=body.get(key).and_then(Value::as_bool){conn.execute(&format!("UPDATE opencode_accounts SET {key}=?,updated_at=? WHERE id=?"),params![v as i64,now(),id]).map_err(|e|e.to_string())?;}}return Ok(account_view(one(conn,"SELECT * FROM opencode_accounts WHERE id=?",&[json!(id)])?));}
      if segments.get(3)==Some(&"usage")&&request.method=="GET"{require_feature(state, USAGE_RECORDS)?;return list_usage(conn,Some(id),qp("offset").and_then(|v|v.parse().ok()).unwrap_or(0),qp("limit").and_then(|v|v.parse().ok()).unwrap_or(100));}
      if segments.get(3)==Some(&"usage")&&segments.get(4)==Some(&"progress"){return Ok(json!({"status":"idle","current":0,"total":0,"inserted":0}));}
    }
    if path=="/usage/sessions"{require_feature(state, USAGE_RECORDS)?;let account=qp("account_id");let mut args=vec![];let where_sql=if let Some(id)=account{args.push(json!(id));"WHERE ur.account_id=?"}else{""};let limit=qp("limit").and_then(|v|v.parse::<i64>().ok()).unwrap_or(50);let offset=qp("offset").and_then(|v|v.parse::<i64>().ok()).unwrap_or(0);let sql=format!(r#"SELECT ur.account_id,oa.name account_name,NULLIF(ur.session_id,'') session_id,MAX(NULLIF(ur.project_path,'')) project_name,MAX(NULLIF(ur.project_path,'')) project_path,MAX(NULLIF(ur.session_title,'')) session_title,COUNT(*) request_count,SUM(ur.input_tokens) total_input_tokens,SUM(ur.output_tokens) total_output_tokens,SUM(ur.reasoning_tokens) total_reasoning_tokens,SUM(ur.cache_read_tokens) total_cache_read_tokens,SUM(ur.cost_usd) total_cost_usd,MIN(ur.created_at) first_at,MAX(ur.created_at) last_at FROM usage_records ur JOIN opencode_accounts oa ON oa.id=ur.account_id {where_sql} GROUP BY ur.account_id,oa.name,ur.session_id ORDER BY last_at DESC LIMIT ? OFFSET ?"#);args.push(json!(limit));args.push(json!(offset));let rows=query_json(conn,&sql,&args)?;return Ok(json!({"total":rows.len(),"sessions":rows,"offset":offset,"limit":limit}));}
    if path=="/usage/session-records"{require_feature(state, USAGE_RECORDS)?;let account=qp("account_id").ok_or("account_id required")?;let session=qp("session_id");let unassigned=qp("unassigned").as_deref()==Some("true");let(session_clause,mut args)=if unassigned{("(ur.session_id IS NULL OR ur.session_id='')",vec![json!(account)])}else{("ur.session_id=?",vec![json!(account),json!(session.unwrap_or_default())])};let total=one(conn,&format!("SELECT COUNT(*) total FROM usage_records ur WHERE ur.account_id=? AND {session_clause}"),&args)?["total"].as_i64().unwrap_or(0);args.push(json!(200));args.push(json!(0));let rows=query_json(conn,&format!("SELECT {} FROM usage_records ur JOIN opencode_accounts oa ON oa.id=ur.account_id WHERE ur.account_id=? AND {session_clause} ORDER BY ur.created_at DESC LIMIT ? OFFSET ?",usage_select()),&args)?;return Ok(json!({"records":rows,"total":total,"offset":0,"limit":200}));}
    Err(format!("Tauri API route not implemented: {} {}",request.method,path))
}

#[tauri::command]
pub async fn api_request(state: tauri::State<'_,BackendState>, request: ApiRequest) -> Result<Value,String>{route(&state,&request).await}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Instant;
  #[test]
  fn migrates_legacy_usage_columns() {
    let directory=tempfile::tempdir().unwrap();let path=directory.path().join("legacy.db");let conn=Connection::open(&path).unwrap();conn.execute_batch("CREATE TABLE opencode_accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,workspace_id TEXT NOT NULL,resolved_workspace_id TEXT,auth_cookie TEXT NOT NULL,show_rolling INTEGER NOT NULL DEFAULT 1,show_weekly INTEGER NOT NULL DEFAULT 1,show_monthly INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE usage_records(usg_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,workspace_id TEXT NOT NULL,created_at TEXT NOT NULL,model TEXT NOT NULL,provider TEXT,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cache_read_tokens INTEGER NOT NULL DEFAULT 0,cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,cost_raw INTEGER NOT NULL,cost_usd REAL NOT NULL,key_id TEXT,plan TEXT,synced_at TEXT NOT NULL);CREATE TABLE usage_sync_state(account_id TEXT PRIMARY KEY,last_sync_at TEXT,last_sync_status TEXT,last_sync_error TEXT,last_inserted_count INTEGER NOT NULL DEFAULT 0,deepest_page_fetched INTEGER NOT NULL DEFAULT -1,total_records INTEGER NOT NULL DEFAULT 0,oldest_record_at TEXT,newest_record_at TEXT);PRAGMA user_version=1;").unwrap();drop(conn);initialize(&path).unwrap();let conn=Connection::open(&path).unwrap();let columns:Vec<String>=conn.prepare("PRAGMA table_info(usage_records)").unwrap().query_map([],|row|row.get(1)).unwrap().collect::<Result<_,_>>().unwrap();assert!(columns.contains(&"reasoning_tokens".into()));assert!(columns.contains(&"project_path".into()));assert_eq!(conn.query_row("PRAGMA user_version",[],|row|row.get::<_,i64>(0)).unwrap(),SCHEMA_VERSION);
  }
  #[test]
  fn fresh_settings_default_to_minimal_flags() {
    let directory=tempfile::tempdir().unwrap();let path=directory.path().join("fresh.db");
    let settings=load_settings(&path);
    assert!(!features::is_enabled(&settings,TOKEN_STATS));
    assert!(!features::is_enabled(&settings,QUOTA_INTELLIGENCE));
    assert_eq!(settings["feature_legacy_prompt_pending"],json!(false));
  }
  #[test]
  fn legacy_settings_keep_full_flags_and_raise_one_time_hint() {
    let directory=tempfile::tempdir().unwrap();let path=directory.path().join("legacy-settings.db");
    let conn=Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE service_settings(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,updated_at TEXT NOT NULL);INSERT INTO service_settings(id,payload,updated_at) VALUES(1,'{\"timezone\":\"UTC\",\"usage_sync\":{\"auto_sync\":false}}','2026-01-01T00:00:00Z');").unwrap();
    drop(conn);
    let settings=load_settings(&path);
    assert_eq!(settings["timezone"],json!("UTC"));
    assert_eq!(settings["usage_sync"]["auto_sync"],json!(false));
    for key in features::FEATURE_KEYS { assert!(features::is_enabled(&settings,key),"{key} should stay enabled for legacy profiles"); }
    assert_eq!(settings["feature_legacy_prompt_pending"],json!(true));
  }
  #[test]
  fn feature_guard_rejects_disabled_groups() {
    let directory=tempfile::tempdir().unwrap();let path=directory.path().join("guard.db");
    let state=BackendState{db_path:path,settings:Arc::new(Mutex::new(default_settings())),quota_refresh_running:Arc::new(Mutex::new(false)),quota_last_refresh:Arc::new(Mutex::new(None))};
    assert!(require_feature(&state,DATA_TOOLS).is_err());
    state.settings.lock().unwrap()["feature_flags"][DATA_TOOLS]=json!(true);
    assert!(require_feature(&state,DATA_TOOLS).is_ok());
  }
  #[test]
  fn rebuilds_cached_quota_from_snapshots_without_network() {
    let directory=tempfile::tempdir().unwrap();let path=directory.path().join("cached.db");
    initialize(&path).unwrap();
    let conn=Connection::open(&path).unwrap();
    conn.execute("INSERT INTO opencode_accounts(id,name,workspace_id,auth_cookie,created_at,updated_at) VALUES('a','A','Default','keyring',?,?)",params![now(),now()]).unwrap();
    conn.execute("INSERT INTO quota_snapshots(account_id,window_label,captured_at,used,remaining,total,reset_at,reset_in_sec) VALUES('a','Monthly',?,42.0,58.0,100.0,?,86400)",params![now(),now()]).unwrap();
    let rows=cached_quota(&conn).unwrap();
    assert_eq!(rows.len(),1);
    assert_eq!(rows[0]["success"],json!(true));
    assert_eq!(rows[0]["windows"][0]["remaining"],json!(58.0));
  }
  #[test]
  fn converts_records_with_iana_timezone_and_dst() {
    let conn=Connection::open_in_memory().unwrap();configure_connection(&conn).unwrap();
    let shanghai:String=conn.query_row("SELECT tz_date('2026-01-01T16:30:00Z','Asia/Shanghai')",[],|row|row.get(0)).unwrap();
    let new_york_hour:String=conn.query_row("SELECT tz_hour('2026-07-01T04:30:00Z','America/New_York')",[],|row|row.get(0)).unwrap();
    assert_eq!(shanghai,"2026-01-02");
    assert_eq!(new_york_hour,"00");
  }
  #[test]
  #[ignore = "manual performance baseline"]
  fn benchmark_100k() {
    let directory=tempfile::tempdir().unwrap();let path=directory.path().join("benchmark.db");initialize(&path).unwrap();let mut conn=Connection::open(&path).unwrap();let started=Instant::now();let tx=conn.transaction().unwrap();{let mut insert=tx.prepare("INSERT INTO opencode_accounts(id,name,workspace_id,auth_cookie,created_at,updated_at) VALUES('a','A','Default','',?,?) ON CONFLICT DO NOTHING").unwrap();insert.execute(params![now(),now()]).unwrap();let mut usage=tx.prepare("INSERT INTO usage_records(usg_id,account_id,workspace_id,created_at,model,input_tokens,output_tokens,cost_raw,cost_usd,synced_at) VALUES(?,'a','w',?, ?,1000,300,1,0.0001,?)").unwrap();for index in 0..100_000{usage.execute(params![format!("u{index}"),Utc::now().to_rfc3339(),format!("model-{}",index%12),now()]).unwrap();}}tx.commit().unwrap();let insert_ms=started.elapsed().as_secs_f64()*1000.0;let mut durations=vec![];for _ in 0..25{let started=Instant::now();let _:Vec<Value>=query_json(&conn,"SELECT model,SUM(cost_usd),SUM(input_tokens+output_tokens),COUNT(*) FROM usage_records WHERE account_id='a' GROUP BY model ORDER BY SUM(cost_usd) DESC",&[]).unwrap();durations.push(started.elapsed().as_secs_f64()*1000.0);}durations.sort_by(f64::total_cmp);println!("{}",json!({"rows":100000,"insert_ms":insert_ms,"aggregation_ms":{"median":durations[durations.len()/2],"p95":durations[(durations.len()as f64*0.95)as usize]}}));
  }
}
