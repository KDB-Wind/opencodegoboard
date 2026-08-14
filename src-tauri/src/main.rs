#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager, menu::{Menu,MenuItem}, tray::{MouseButton,MouseButtonState,TrayIconBuilder,TrayIconEvent}, WindowEvent};
use tauri_plugin_opener::OpenerExt;
mod backend;
mod quota;
mod usage;
mod secrets;

struct Preferences { enabled:Mutex<bool>, path:std::path::PathBuf }

fn save_tray_preference(preferences:&Preferences,enabled:bool){if let Some(parent)=preferences.path.parent(){let _=std::fs::create_dir_all(parent);}let _=std::fs::write(&preferences.path,if enabled{"true"}else{"false"});}

fn import_legacy_database(target:&std::path::Path) {
    if target.exists(){return}
    let Some(appdata)=std::env::var_os("APPDATA") else{return};
    for relative in [["OpenCodeBoard","data","68backend.db"],["68hub","data","68backend.db"]] {
        let source=relative.iter().fold(std::path::PathBuf::from(&appdata),|path,part|path.join(part));
        if source.is_file(){if let Some(parent)=target.parent(){let _=std::fs::create_dir_all(parent);}if std::fs::copy(&source,target).is_ok(){break}}
    }
}

#[tauri::command]
fn request_close(app: tauri::AppHandle, preferences: tauri::State<Preferences>) -> String {
    if *preferences.enabled.lock().expect("tray preference lock") {
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
        *preferences.enabled.lock().expect("tray preference lock") = true;save_tray_preference(&preferences,true);
        if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
        "hide".into()
    } else {
        app.exit(0);
        "quit".into()
    }
}

#[tauri::command]
fn get_tray_mode(preferences: tauri::State<Preferences>) -> bool {
    *preferences.enabled.lock().expect("tray preference lock")
}

#[tauri::command]
fn set_tray_mode(preferences: tauri::State<Preferences>, enabled: bool) -> bool {
    *preferences.enabled.lock().expect("tray preference lock") = enabled;save_tray_preference(&preferences,enabled);
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
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let preference_path=data_dir.join("tray-mode.txt");let tray_enabled=std::fs::read_to_string(&preference_path).map(|v|v.trim()=="true").unwrap_or(false);
            app.manage(Preferences{enabled:Mutex::new(tray_enabled),path:preference_path});
            let db_path = data_dir.join("opencodegoboard.db");
            import_legacy_database(&db_path);
            backend::initialize(&db_path).map_err(std::io::Error::other)?;
            backend::migrate_legacy_credentials(&db_path).map_err(std::io::Error::other)?;
            let settings = backend::load_settings(&db_path);
            app.manage(backend::BackendState { db_path, settings: Mutex::new(settings) });
            let show=MenuItem::with_id(app,"show","显示窗口",true,None::<&str>)?;let quit=MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;let menu=Menu::with_items(app,&[&show,&quit])?;
            TrayIconBuilder::new().icon(app.default_window_icon().ok_or("missing application icon")?.clone()).tooltip("OpenCodeGoBoard").menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){"show"=>{if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}},"quit"=>app.exit(0),_=>{}}).on_tray_icon_event(|tray,event|{if let TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}=event{let app=tray.app_handle();if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}}}).build(app)?;
            Ok(())
        })
        .on_window_event(|window,event|if let WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let app=window.app_handle();let preferences=app.state::<Preferences>();if *preferences.enabled.lock().expect("tray preference lock"){let _=window.hide();}else{let _=app.emit("close-dialog-request",());}})
        .invoke_handler(tauri::generate_handler![request_close, close_confirm, get_tray_mode, set_tray_mode, open_external, open_opencode_login, backend::api_request])
        .run(tauri::generate_context!())
        .expect("failed to run OpenCodeGoBoard");
}
