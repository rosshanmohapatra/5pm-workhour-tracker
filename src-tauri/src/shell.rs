// Tray presence and native notifications.
//
// Closing the window hides it instead of quitting. That is not only a
// convenience: the session and overtime alerts are setTimeout timers living in
// the webview, so quitting the process silently cancelled every pending alert.
// Staying resident in the tray is what makes those notifications arrive at all.

use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager,
};
use tauri_plugin_notification::NotificationExt;

// WebView2 has no Web Notifications API, so lib/desktop-notify.js shims
// window.Notification onto this command and every existing call site keeps working.
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
  app
    .notification()
    .builder()
    .title(if title.is_empty() { "5pm".to_string() } else { title })
    .body(body)
    .show()
    .map_err(|e| e.to_string())
}

// Windows passes this when it launches 5pm at sign-in. That run stays in the
// tray and starts the day's session by itself; every other launch is a person
// opening the app.
pub const AUTOSTART_FLAG: &str = "--autostart";

static BOOT_LAUNCH: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

pub fn launched_by_autostart() -> bool {
  *BOOT_LAUNCH.get().unwrap_or(&std::env::args().any(|arg| arg == AUTOSTART_FLAG))
}

// The updater relaunches 5pm with the arguments it was running with, so an app
// that booted into the tray would come back hidden after a Settings update.
// updater_install leaves this marker; the relaunch that finds it is treated as
// someone opening the app.
const UPDATE_MARKER: &str = "update-relaunch";

pub fn mark_update_relaunch(app: &AppHandle) {
  if let Ok(dir) = app.path().app_config_dir() {
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join(UPDATE_MARKER), "1");
  }
}

// Call once in setup, before anything reads launched_by_autostart().
pub fn resolve_launch_kind(app: &AppHandle) {
  let updated = app
    .path()
    .app_config_dir()
    .map(|dir| std::fs::remove_file(dir.join(UPDATE_MARKER)).is_ok())
    .unwrap_or(false);
  let boot = !updated && std::env::args().any(|arg| arg == AUTOSTART_FLAG);
  let _ = BOOT_LAUNCH.set(boot);
}

#[tauri::command]
pub fn launched_at_boot() -> bool {
  launched_by_autostart()
}

// The page pushes what the tray should say, because only it knows the target,
// the breaks and what has been worked so far.
#[tauri::command]
pub fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
  let Some(tray) = app.tray_by_id("main") else {
    return Ok(()); // no tray on this platform, nothing to say
  };
  tray
    .set_tooltip(Some(if text.is_empty() { "5pm".into() } else { text }))
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
  use tauri_plugin_autostart::ManagerExt;
  app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
  use tauri_plugin_autostart::ManagerExt;
  let manager = app.autolaunch();
  if enabled {
    manager.enable().map_err(|e| e.to_string())
  } else {
    manager.disable().map_err(|e| e.to_string())
  }
}

// Enabled once, on the first run after install. Touching the marker before
// enabling means a failure here is not retried on every launch, and a user who
// switches it off in Settings is never overridden.
pub fn enable_autostart_on_first_run(app: &AppHandle) {
  use tauri_plugin_autostart::ManagerExt;

  let Ok(dir) = app.path().app_config_dir() else {
    return;
  };
  let marker = dir.join("autostart-initialised");
  if marker.exists() {
    // Re-register an existing entry so it carries the current arguments.
    // Installs that first enabled this on 1.2.5 have a Windows entry without
    // --autostart, so every sign-in looked like a manual open: the window
    // showed and the day never started.
    if app.autolaunch().is_enabled().unwrap_or(false) {
      let _ = app.autolaunch().enable();
    }
    return;
  }

  let _ = std::fs::create_dir_all(&dir);
  let _ = std::fs::write(&marker, "1");
  let _ = app.autolaunch().enable();
}

static SHOWN_ONCE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn show_main(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    // Open full screen like a browser the first time the window appears in a
    // run (launch, or first Open from the tray after a boot). Later shows keep
    // whatever size the user left it at.
    if !SHOWN_ONCE.swap(true, std::sync::atomic::Ordering::Relaxed) {
      let _ = window.maximize();
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
  let open = MenuItem::with_id(app, "open", "Open 5pm", true, None::<&str>)?;
  let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open, &exit])?;

  TrayIconBuilder::with_id("main")
    .icon(app.default_window_icon().unwrap().clone())
    .tooltip("5pm")
    .menu(&menu)
    // Left click restores the window; the menu belongs on right click only.
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "open" => show_main(app),
      "exit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_main(tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}
