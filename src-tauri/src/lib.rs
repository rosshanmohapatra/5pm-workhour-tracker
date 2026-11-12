mod idle;
mod oauth;
mod shell;
mod store;
mod updater;

// Sign-in belongs in the real browser, where the user's Google session already
// lives. Navigating the app's own webview there strands the app on a Google page
// and providers often refuse embedded webviews outright.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
  use tauri_plugin_opener::OpenerExt;
  if !(url.starts_with("https://") || url.starts_with("mailto:")) {
    return Err("refusing to open a url that is not https or mailto".into());
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
      shell::notify_update,
      shell::autostart_enabled,
      shell::autostart_set,
      shell::launched_at_boot,
      shell::set_tray_tooltip,
      store::is_store_app,
      open_external
    ])
    .on_window_event(|window, event| {
      use tauri::Manager;
      let webview = window.app_handle().get_webview_window(window.label());
      match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
          api.prevent_close();
          let _ = window.hide();
          if let Some(w) = &webview { idle::set_background(w, true); }
          shell::tray_tip_once(window.app_handle());
        }
        // Minimise and restore both arrive as a resize.
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true) => {
          if let Some(w) = &webview { idle::set_background(w, idle::is_out_of_sight(w)); }
        }
        _ => {}
      }
    })
    // A launch at sign-in loads the page straight into the tray: start it in
    // background mode. Also re-applies the class after a reload while hidden.
    .on_page_load(|webview, payload| {
      use tauri::Manager;
      if payload.event() == tauri::webview::PageLoadEvent::Finished {
        if let Some(w) = webview.app_handle().get_webview_window(webview.label()) {
          if idle::is_out_of_sight(&w) { idle::set_background(&w, true); }
        }
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
