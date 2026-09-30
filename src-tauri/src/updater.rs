// Desktop update flow: check -> download (cancellable, reports progress) -> install.
// Download and install both go through tauri-plugin-updater, so the payload is
// signature-verified before it is ever executed.

use std::sync::{
  atomic::{AtomicU64, Ordering},
  Arc, Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState {
  available: Mutex<Option<Arc<Update>>>,
  payload: Mutex<Option<Vec<u8>>>,
  task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
  version: String,
  current_version: String,
  date: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
  downloaded: u64,
  total: Option<u64>,
}

#[tauri::command]
pub async fn updater_check(
  app: AppHandle,
  state: State<'_, UpdateState>,
) -> Result<Option<UpdateInfo>, String> {
  let found = app
    .updater()
    .map_err(|e| e.to_string())?
    .check()
    .await
    .map_err(|e| e.to_string())?;

  match found {
    Some(update) => {
      let info = UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        date: update.date.map(|d| d.to_string()),
      };
      *state.available.lock().unwrap() = Some(Arc::new(update));
      Ok(Some(info))
    }
    None => {
      *state.available.lock().unwrap() = None;
      Ok(None)
    }
  }
}

#[tauri::command]
pub fn updater_download(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
  let update = state
    .available
    .lock()
    .unwrap()
    .clone()
    .ok_or("no update available")?;

  let handle = app.clone();
  let downloaded = Arc::new(AtomicU64::new(0));

  let task = tauri::async_runtime::spawn(async move {
    let progress_handle = handle.clone();
    let counter = downloaded.clone();

    let result = update
      .download(
        move |chunk, total| {
          let seen = counter.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
          let _ = progress_handle.emit(
            "updater://progress",
            Progress {
              downloaded: seen,
              total,
            },
          );
        },
        || {},
      )
      .await;

    match result {
      Ok(bytes) => {
        *handle.state::<UpdateState>().payload.lock().unwrap() = Some(bytes);
        let _ = handle.emit("updater://ready", ());
      }
      Err(e) => {
        let _ = handle.emit("updater://error", e.to_string());
      }
    }
  });

  *state.task.lock().unwrap() = Some(task);
  Ok(())
}

// Aborting mid-download only drops the in-memory payload. The installed app and
// all 5pm data on disk are untouched, because nothing is written until install.
#[tauri::command]
pub fn updater_cancel(state: State<'_, UpdateState>) {
  if let Some(task) = state.task.lock().unwrap().take() {
    task.abort();
  }
  *state.payload.lock().unwrap() = None;
}

#[tauri::command]
pub fn updater_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
  let update = state
    .available
    .lock()
    .unwrap()
    .clone()
    .ok_or("no update available")?;
  let bytes = state
    .payload
    .lock()
    .unwrap()
    .take()
    .ok_or("update not downloaded")?;

  crate::shell::mark_update_relaunch(&app);
  update.install(bytes).map_err(|e| e.to_string())?;
  app.restart();
}
