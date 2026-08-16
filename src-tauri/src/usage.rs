use crate::http::{client, get_text_with_retries};
use crate::quota::{cookie, resolve_workspace, QuotaAccount};
use chrono::{SecondsFormat, Utc};
use regex::Regex;
use reqwest::header;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::path::Path;
use uuid::Uuid;

const SERVER_ID: &str = "bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c";

fn capture_string(body: &str, name: &str) -> String {
    Regex::new(&format!(r#"{}\s*:\s*"([^"]*)""#, regex::escape(name)))
        .ok().and_then(|re| re.captures(body)).map(|c| c[1].to_string()).unwrap_or_default()
}

fn capture_number(body: &str, name: &str) -> i64 {
    Regex::new(&format!(r"{}\s*:\s*(\d+|null)", regex::escape(name)))
        .ok().and_then(|re| re.captures(body)).and_then(|c| c[1].parse().ok()).unwrap_or(0)
}

pub fn parse(text: &str) -> Result<Vec<Value>, String> {
    let anchor = Regex::new(r#"id\s*:\s*"(usg_[^"]+)""#).unwrap();
    let date = Regex::new(r#"timeCreated\s*:\s*\$R\[\d+\]\s*=\s*new Date\("([^"]+)"\)"#).unwrap();
    let matches: Vec<_> = anchor.captures_iter(text).collect();
    let mut records = vec![];
    for (index, cap) in matches.iter().enumerate() {
        let start = cap.get(0).unwrap().end();
        let end = matches.get(index + 1).and_then(|next| next.get(0)).map(|m| m.start()).unwrap_or(text.len());
        let body = &text[start..end];
        let Some(created) = date.captures(body).map(|c| c[1].to_string()) else { continue };
        let cost = capture_number(body, "cost");
        let project_path = { let value = capture_string(body, "projectPath"); if value.is_empty() { capture_string(body, "directory") } else { value } };
        let session_title = { let value = capture_string(body, "sessionTitle"); if value.is_empty() { capture_string(body, "title") } else { value } };
        records.push(json!({
            "usg_id":cap[1].to_string(),"created_at":created,"model":capture_string(body,"model"),
            "provider":capture_string(body,"provider"),"input_tokens":capture_number(body,"inputTokens"),
            "output_tokens":capture_number(body,"outputTokens"),"reasoning_tokens":capture_number(body,"reasoningTokens"),
            "cache_read_tokens":capture_number(body,"cacheReadTokens"),"cache_write_5m_tokens":capture_number(body,"cacheWrite5mTokens"),
            "cache_write_1h_tokens":capture_number(body,"cacheWrite1hTokens"),"cost_raw":cost,"cost_usd":cost as f64/100_000_000.0,
            "key_id":capture_string(body,"keyID"),"session_id":capture_string(body,"sessionID"),
            "project_path":project_path,"session_title":session_title,"plan":Value::Null
        }));
    }
    if records.len() != matches.len() {
        return Err(format!("用量响应包含 {} 条记录锚点，其中 {} 条无法解析", matches.len(), matches.len() - records.len()));
    }
    Ok(records)
}

async fn fetch_page(workspace: &str, secret: &str, page: usize) -> Result<Vec<Value>, String> {
    let args = if page == 0 { json!([workspace]) } else { json!([workspace, page]) };
    let url = format!("https://opencode.ai/_server?id={SERVER_ID}&args={}", urlencoding::encode(&args.to_string()));
    let client = client()?;
    let (status, text) = get_text_with_retries(|| {
        client.get(&url).header(header::COOKIE, cookie(secret)).header("X-Server-Id", SERVER_ID)
            .header("X-Server-Instance", format!("server-fn:{}", Uuid::new_v4()))
            .header(header::ORIGIN, "https://opencode.ai")
            .header(header::REFERER, format!("https://opencode.ai/workspace/{workspace}/usage"))
    }).await?;
    if !status.is_success() { return Err(format!("使用记录查询返回 HTTP {}", status.as_u16())); }
    parse(&text)
}

fn insert_batch(conn: &mut Connection, account: &str, workspace: &str, pages: &[Vec<Value>]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e|e.to_string())?;
    let mut inserted = 0;
    for record in pages.iter().flatten() {
        inserted += tx.execute(r#"INSERT INTO usage_records(usg_id,account_id,workspace_id,created_at,model,provider,input_tokens,output_tokens,reasoning_tokens,cache_read_tokens,cache_write_5m_tokens,cache_write_1h_tokens,cost_raw,cost_usd,key_id,session_id,project_path,session_title,plan,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(usg_id) DO UPDATE SET input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,reasoning_tokens=excluded.reasoning_tokens,cache_read_tokens=excluded.cache_read_tokens,cache_write_5m_tokens=excluded.cache_write_5m_tokens,cache_write_1h_tokens=excluded.cache_write_1h_tokens,cost_raw=excluded.cost_raw,cost_usd=excluded.cost_usd,session_id=excluded.session_id,project_path=COALESCE(NULLIF(excluded.project_path,''),usage_records.project_path),session_title=COALESCE(NULLIF(excluded.session_title,''),usage_records.session_title),synced_at=excluded.synced_at"#,
            params![record["usg_id"].as_str(),account,workspace,record["created_at"].as_str(),record["model"].as_str(),record["provider"].as_str(),record["input_tokens"].as_i64(),record["output_tokens"].as_i64(),record["reasoning_tokens"].as_i64(),record["cache_read_tokens"].as_i64(),record["cache_write_5m_tokens"].as_i64(),record["cache_write_1h_tokens"].as_i64(),record["cost_raw"].as_i64(),record["cost_usd"].as_f64(),record["key_id"].as_str(),record["session_id"].as_str(),record["project_path"].as_str(),record["session_title"].as_str(),record["plan"].as_str(),Utc::now().to_rfc3339_opts(SecondsFormat::Secs,true)]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())?;
    Ok(inserted)
}

pub async fn sync(db_path: &Path, account_id: &str, max_pages: usize, stop_at: Option<&str>) -> Result<Value, String> {
    let conn = Connection::open(db_path).map_err(|e|e.to_string())?;
    let mut account = conn.query_row("SELECT id,name,workspace_id,auth_cookie,show_rolling,show_weekly,show_monthly FROM opencode_accounts WHERE id=?",params![account_id],|r|Ok(QuotaAccount{id:r.get(0)?,name:r.get(1)?,workspace_id:r.get(2)?,auth_cookie:r.get(3)?,show_rolling:r.get::<_,i64>(4)?!=0,show_weekly:r.get::<_,i64>(5)?!=0,show_monthly:r.get::<_,i64>(6)?!=0})).map_err(|e|e.to_string())?;
    if account.auth_cookie == "keyring" { account.auth_cookie=crate::secrets::get(account_id)?; }
    else if account.auth_cookie.starts_with("enc:") { return Err("旧版加密凭据无法直接迁移，请重新登录一次".into()); }
    drop(conn);
    let workspace = resolve_workspace(&account).await?;
    let mut total = 0;
    let mut fetched = 0;
    let mut page = 0;
    while page < max_pages {
        let batch_start = page;
        let batch_end = (page + 5).min(max_pages);
        let mut batch = vec![];
        let mut reached_target = false;
        for current in batch_start..batch_end {
            match fetch_page(&workspace,&account.auth_cookie,current).await {
                Ok(rows) => {
                    fetched += 1;
                    let short_page = rows.len() < 50;
                    let passed_cutoff = stop_at.is_some_and(|cutoff| rows.iter().filter_map(|row|row["created_at"].as_str()).any(|created|created <= cutoff));
                    batch.push(rows);
                    if short_page || passed_cutoff { reached_target = true; break; }
                },
                Err(error) => {
                    let conn=Connection::open(db_path).map_err(|e|e.to_string())?;
                    conn.execute("UPDATE usage_sync_state SET last_sync_at=?,last_sync_status=?,last_sync_error=?,last_failed_page=?,last_inserted_count=? WHERE account_id=?",params![Utc::now().to_rfc3339_opts(SecondsFormat::Secs,true),if total>0{"partial"}else{"error"},error,current as i64,total as i64,account_id]).map_err(|e|e.to_string())?;
                    return Err(error)
                }
            }
        }
        let mut conn=Connection::open(db_path).map_err(|e|e.to_string())?;
        total += insert_batch(&mut conn,account_id,&workspace,&batch)?;
        let deepest=batch_start+batch.len()-1;
        conn.execute("UPDATE usage_sync_state SET deepest_page_fetched=MAX(deepest_page_fetched,?),last_inserted_count=? WHERE account_id=?",params![deepest as i64,total as i64,account_id]).map_err(|e|e.to_string())?;
        page += batch.len();
        if reached_target { break; }
    }
    let timestamp=Utc::now().to_rfc3339_opts(SecondsFormat::Secs,true);
    let conn=Connection::open(db_path).map_err(|e|e.to_string())?;
    conn.execute("UPDATE usage_sync_state SET last_sync_at=?,last_success_at=?,last_sync_status='ok',last_sync_error=NULL,last_failed_page=NULL,last_parse_error_count=0,last_inserted_count=?,total_records=(SELECT COUNT(*) FROM usage_records WHERE account_id=?),oldest_record_at=(SELECT MIN(created_at) FROM usage_records WHERE account_id=?),newest_record_at=(SELECT MAX(created_at) FROM usage_records WHERE account_id=?) WHERE account_id=?",params![timestamp,timestamp,total as i64,account_id,account_id,account_id,account_id]).map_err(|e|e.to_string())?;
    Ok(json!({"inserted":total,"pages_fetched":fetched,"sync_at":timestamp,"status":"ok"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_fixture_shape() {
        let text=r#"id: "usg_123", timeCreated: $R[1] = new Date("2026-01-01T00:00:00Z"), model: "gpt", inputTokens: 10, outputTokens: 2, cost: 100000000"#;
        let rows=parse(text).unwrap();
        assert_eq!(rows[0]["cost_usd"],1.0);
    }
}
