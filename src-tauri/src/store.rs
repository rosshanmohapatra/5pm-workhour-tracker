// Microsoft Store build. The same 5pm.exe runs from the installer and from the
// Store package; it checks which one it is at run time.
//
// From the Store:
//  - the Store updates the app, so the in-app updater stays off;
//  - Open at Login is the package's StartupTask (AppxManifest.xml), because
//    the registry Run key the installer build uses is private to the package;
//  - notifications go out under the package's app ID, the only one Windows
//    accepts from a packaged app.

// The StartupTask id in store/AppxManifest.xml.
#[cfg(windows)]
const STARTUP_TASK_ID: &str = "FivePmStartup";

#[cfg(windows)]
pub fn is_packaged() -> bool {
  use std::sync::OnceLock;
  static PACKAGED: OnceLock<bool> = OnceLock::new();
  *PACKAGED.get_or_init(|| windows::ApplicationModel::Package::Current().is_ok())
}

#[cfg(not(windows))]
pub fn is_packaged() -> bool {
  false
}

#[tauri::command]
pub fn is_store_app() -> bool {
  is_packaged()
}

// "RoshanMahapatra.5pm_a5bwd4wc20wda!App": family name plus the Application Id.
#[cfg(windows)]
pub fn app_user_model_id() -> Option<String> {
  let family = windows::ApplicationModel::Package::Current().ok()?.Id().ok()?.FamilyName().ok()?;
  Some(format!("{family}!App"))
}

// Windows started the package at sign-in (its StartupTask), not a person.
#[cfg(windows)]
pub fn launched_by_startup_task() -> bool {
  use windows::ApplicationModel::{Activation::ActivationKind, AppInstance};
  if !is_packaged() {
    return false;
  }
  AppInstance::GetActivatedEventArgs()
    .and_then(|args| args.Kind())
    .map(|kind| kind == ActivationKind::StartupTask)
    .unwrap_or(false)
}

#[cfg(windows)]
fn startup_task() -> Option<windows::ApplicationModel::StartupTask> {
  windows::ApplicationModel::StartupTask::GetAsync(&STARTUP_TASK_ID.into()).ok()?.join().ok()
}

#[cfg(windows)]
pub fn autostart_enabled() -> Result<bool, String> {
  use windows::ApplicationModel::StartupTaskState as S;
  let task = startup_task().ok_or("startup task not found")?;
  let state = task.State().map_err(|e| e.to_string())?;
  Ok(matches!(state, S::Enabled | S::EnabledByPolicy))
}

// Called from async commands: waiting on Windows here must stay off the UI thread.
// Turning it on can be refused: the user switched 5pm off in Windows Settings
// › Apps › Startup, or a policy did. Only Windows Settings can undo that.
#[cfg(windows)]
pub fn autostart_set(enabled: bool) -> Result<(), String> {
  use windows::ApplicationModel::StartupTaskState as S;
  let task = startup_task().ok_or("startup task not found")?;
  if !enabled {
    return task.Disable().map_err(|e| e.to_string());
  }
  let state = task.RequestEnableAsync().and_then(|op| op.join()).map_err(|e| e.to_string())?;
  match state {
    S::Enabled | S::EnabledByPolicy => Ok(()),
    S::DisabledByUser => Err("Turn 5pm back on in Windows Settings › Apps › Startup.".into()),
    _ => Err("Windows didn't allow 5pm to open at login.".into()),
  }
}
