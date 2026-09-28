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
      use tauri::Manager;
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
      }
    }));
  }

  builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_opener::init())
    .manage(updater::UpdateState::default())
    .invoke_handler(tauri::generate_handler![
      updater::updater_check,
      updater::updater_download,
      updater::updater_cancel,
      updater::updater_install,
      open_external
    ])
    .setup(|app| {
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
