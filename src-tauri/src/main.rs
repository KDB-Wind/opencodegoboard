#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
mod backend;
mod quota;
mod usage;

struct Preferences(Mutex<bool>);

#[tauri::command]
fn request_close(app: tauri::AppHandle, preferences: tauri::State<Preferences>) -> String {
    if *preferences.0.lock().expect("tray preference lock") {
        if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
        "hide".into()
    } else {
        let _ = app.emit("close-dialog-request", ());
        "ask".into()
    }
}

#[tauri::command]
fn close_confirm(app: tauri::AppHandle, preferences: tauri::State<Preferences>, action: String) -> String {
    if action == "hide" {
        *preferences.0.lock().expect("tray preference lock") = true;
        if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
        "hide".into()
    } else {
        app.exit(0);
        "quit".into()
    }
}

#[tauri::command]
fn get_tray_mode(preferences: tauri::State<Preferences>) -> bool {
    *preferences.0.lock().expect("tray preference lock")
}

#[tauri::command]
fn set_tray_mode(preferences: tauri::State<Preferences>, enabled: bool) -> bool {
    *preferences.0.lock().expect("tray preference lock") = enabled;
    enabled
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let allowed = url.starts_with("https://opencode.ai/") || url.starts_with("https://github.com/");
    if !allowed { return Err("external URL is not allowlisted".into()); }
    app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_opencode_login(app: tauri::AppHandle) -> Result<bool, String> {
    app.opener().open_url("https://opencode.ai/auth", None::<&str>).map_err(|error| error.to_string())?;
    Ok(true)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Preferences(Mutex::new(false)))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("opencodegoboard.db");
            backend::initialize(&db_path).map_err(std::io::Error::other)?;
            app.manage(backend::BackendState { db_path, settings: Mutex::new(serde_json::json!({
                "refresh":{"opencode_go":{"auto_refresh":true,"interval_sec":60}},
                "usage_sync":{"auto_sync":true,"interval_sec":300,"backfill_pages_per_request":100,"max_pages_per_incremental":30}
            })) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![request_close, close_confirm, get_tray_mode, set_tray_mode, open_external, open_opencode_login, backend::api_request])
        .run(tauri::generate_context!())
        .expect("failed to run OpenCodeGoBoard");
}
