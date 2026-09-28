mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_deep_link::init())
    .manage(updater::UpdateState::default())
    .invoke_handler(tauri::generate_handler![
      updater::updater_check,
      updater::updater_download,
      updater::updater_cancel,
      updater::updater_install
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
