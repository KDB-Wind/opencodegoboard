use chrono::{Duration, SecondsFormat, Utc};
use futures::future::join_all;
use regex::Regex;
use reqwest::header;
use serde_json::{json, Value};

use crate::http::{client, get_text_with_retries};

const WORKSPACE_SERVER_ID: &str = "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";

#[derive(Clone)]
pub struct QuotaAccount { pub id:String,pub name:String,pub workspace_id:String,pub auth_cookie:String,pub show_rolling:bool,pub show_weekly:bool,pub show_monthly:bool }

pub fn cookie(raw:&str)->String{let value=raw.trim().strip_prefix("Cookie:").unwrap_or(raw.trim()).trim();value.split(';').find(|part|part.trim().starts_with("auth=")).map(|v|v.trim().to_string()).unwrap_or_else(||format!("auth={value}"))}

pub async fn resolve_workspace(account:&QuotaAccount)->Result<String,String>{
  if account.workspace_id.starts_with("wrk_"){return Ok(account.workspace_id.clone())}
  let url=format!("https://opencode.ai/_server?id={WORKSPACE_SERVER_ID}");
  let client=client()?;
  let (status,text)=get_text_with_retries(||{
    client.get(&url).header(header::COOKIE,cookie(&account.auth_cookie)).header("X-Server-Id",WORKSPACE_SERVER_ID).header("X-Server-Instance",format!("server-fn:{}",Utc::now().timestamp_nanos_opt().unwrap_or_default())).header(header::ORIGIN,"https://opencode.ai").header(header::REFERER,"https://opencode.ai")
  }).await?;
  if !status.is_success(){return Err(format!("工作区查询返回 HTTP {}",status.as_u16()))}
  let re=Regex::new(r#"id\s*:\s*"(wrk_[^"]+)"[^{}]*?name\s*:\s*"([^"]*)""#).unwrap();
  let refs:Vec<(String,String)>=re.captures_iter(&text).map(|c|(c[1].to_string(),c[2].to_string())).collect();
  refs.iter().find(|(_,name)|name.eq_ignore_ascii_case(account.workspace_id.trim())).or_else(||refs.first()).map(|(id,_)|id.clone()).ok_or_else(||"无法从账号数据解析工作区 ID".into())
}

fn parse_pair(text:&str,field:&str)->Option<(f64,i64)>{
  let block=Regex::new(&format!(r#"{field}:\s*\$R\[\d+\]\s*=\s*\{{([^}}]*)\}}"#)).ok()?.captures(text)?.get(1)?.as_str().to_string();
  let pct=Regex::new(r"usagePercent\s*:\s*(-?\d+(?:\.\d+)?)").ok()?.captures(&block)?.get(1)?.as_str().parse().ok()?;
  let reset=Regex::new(r"resetInSec\s*:\s*(-?\d+(?:\.\d+)?)").ok()?.captures(&block)?.get(1)?.as_str().parse::<f64>().ok()? as i64;Some((pct,reset))
}

fn round_percent(value:f64)->f64{(value*1_000_000.0).round()/1_000_000.0}

pub fn parse_windows(text:&str)->Vec<Value>{[("5h Rolling","rollingUsage"),("Weekly","weeklyUsage"),("Monthly","monthlyUsage")].iter().filter_map(|(label,field)|parse_pair(text,field).map(|(used,reset)|{let used=used.clamp(0.0,100.0);let remaining=round_percent(100.0-used);json!({"label":label,"used":used,"remaining":remaining,"total":100.0,"unit":"%","reset_at":(Utc::now()+Duration::seconds(reset)).to_rfc3339_opts(SecondsFormat::Secs,true),"reset_in_sec":reset})})).collect()}

pub async fn fetch(account:QuotaAccount,index:usize)->Value{
  let updated=Utc::now().to_rfc3339_opts(SecondsFormat::Secs,true);let hint=account.workspace_id.clone();
  let result=async{if account.auth_cookie.trim().is_empty(){return Err("未配置 auth cookie".into())}let workspace=resolve_workspace(&account).await?;let url=format!("https://opencode.ai/workspace/{workspace}/go");let client=client()?;let(status,text)=get_text_with_retries(||{client.get(&url).header(header::COOKIE,cookie(&account.auth_cookie)).header(header::ACCEPT,"text/html, application/xhtml+xml")}).await?;if !status.is_success(){return Err(format!("Dashboard 返回 HTTP {}",status.as_u16()))}let mut windows=parse_windows(&text);windows.retain(|w|match w["label"].as_str(){Some("5h Rolling")=>account.show_rolling,Some("Weekly")=>account.show_weekly,Some("Monthly")=>account.show_monthly,_=>true});if windows.is_empty(){return Err("无法从 Dashboard HTML 解析额度数据".into())}Ok((workspace,windows))}.await;
  match result{Ok((workspace,windows))=>json!({"index":index,"account_id":account.id,"name":account.name,"workspace_id":workspace,"success":true,"updated_at":updated,"windows":windows}),Err(error)=>json!({"index":index,"account_id":account.id,"name":account.name,"workspace_id":hint,"success":false,"updated_at":updated,"windows":[],"error":error})}
}

pub async fn fetch_all(accounts:Vec<QuotaAccount>)->Vec<Value>{join_all(accounts.into_iter().enumerate().map(|(index,account)|fetch(account,index))).await}

#[cfg(test)]
mod tests{use super::*;#[test]fn parses_compact_and_spaced_windows(){let rows=parse_windows(r#"rollingUsage: $R[1] = {usagePercent: 25.5, resetInSec:3600} weeklyUsage:$R[2]={resetInSec: 7200,usagePercent: 40}"#);assert_eq!(rows.len(),2);assert_eq!(rows[0]["remaining"],74.5);}#[test]fn rounds_remaining_percent_without_binary_float_artifacts(){let rows=parse_windows(r#"monthlyUsage: $R[1] = {usagePercent: 95.4, resetInSec:3600}"#);assert_eq!(rows[0]["remaining"],4.6);}}
