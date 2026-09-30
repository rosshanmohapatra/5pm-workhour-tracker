mod oauth;
mod shell;
mod updater;

// Sign-in belongs in the real browser, where the user's Google session already
// lives. Navigating the app's own webview there strands the app on a Google page
// and providers often refuse embedded webviews outright.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
  use tauri_plugin_opener::OpenerExt;
  if !url.starts_with("https://") {
    return Err("refusing to open a non-https url".into());
  }
  app
    .opener()
    .open_url(url, None::<&str>)
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Must be registered before every other plugin, or a fivepm:// link opens a
  // second copy of the app instead of reaching the one already running.
  #[cfg(any(target_os = "windows", target_os = "linux"))]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      shell::show_main(app);
    }));
  }

  builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec![shell::AUTOSTART_FLAG]),
    ))
    .manage(updater::UpdateState::default())
    .invoke_handler(tauri::generate_handler![
      updater::updater_check,
      updater::updater_download,
      updater::updater_cancel,
      updater::updater_install,
      oauth::oauth_listen,
      shell::notify,
      shell::autostart_enabled,
      shell::autostart_set,
      shell::launched_at_boot,
      shell::set_tray_tooltip,
      open_external
    ])
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .setup(|app| {
      shell::resolve_launch_kind(app.handle());
      shell::build_tray(app.handle())?;
      shell::enable_autostart_on_first_run(app.handle());

      // A launch at sign-in stays in the tray and announces itself with a
      // notification instead. Every other launch is someone opening the app.
      if !shell::launched_by_autostart() {
        shell::show_main(app.handle());
      }

      // The installer registers fivepm:// on Windows. This covers `tauri dev`,
      // where no installer has run.
      #[cfg(desktop)]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        let _ = app.deep_link().register_all();
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
