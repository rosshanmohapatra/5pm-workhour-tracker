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

pub fn show_main(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
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
