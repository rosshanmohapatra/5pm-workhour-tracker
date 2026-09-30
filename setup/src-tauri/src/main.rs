// 5pm Setup. Shows the branded screens in ../ui and runs the real NSIS
// installer (embedded at build time) silently underneath. The NSIS installer
// stays the single source of truth for what gets installed and where; the
// in-app updater keeps using it directly.
#![windows_subsystem = "windows"]

use std::{
  fs,
  io::Write,
  os::windows::process::CommandExt,
  path::PathBuf,
  process::Command,
  thread,
  time::{Duration, SystemTime},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

static INSTALLER: &[u8] = include_bytes!(env!("FIVEPM_INSTALLER"));
const APP_EXE_SIZE: &str = env!("FIVEPM_APP_EXE_SIZE");

const UNINSTALL_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\5pm";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Clone)]
struct Progress {
  pct: f64,
  stage: &'static str, // "unpack" | "copy" | "finish", mapped to words in the UI
}

// One value from 5pm's uninstall entry, written by the NSIS installer.
fn reg_value(name: &str) -> Option<String> {
  let out = Command::new("reg")
    .args(["query", UNINSTALL_KEY, "/v", name])
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .ok()?;
  let text = String::from_utf8_lossy(&out.stdout);
  let line = text.lines().find(|l| l.trim_start().starts_with(name))?;
  let value = line.split("REG_SZ").nth(1)?.trim().trim_matches('"');
  (!value.is_empty()).then(|| value.to_string())
}

fn install_dir() -> PathBuf {
  reg_value("InstallLocation").map(PathBuf::from).unwrap_or_else(|| {
    // NSIS per-user default: $LOCALAPPDATA\<productName>
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("5pm")
  })
}

fn app_exe() -> PathBuf {
  install_dir().join(reg_value("MainBinaryName").unwrap_or_else(|| "app.exe".into()))
}

fn emit(app: &AppHandle, pct: f64, stage: &'static str) {
  let _ = app.emit("setup://progress", Progress { pct: pct.clamp(0.0, 100.0), stage });
}

// true when 5pm is already on this PC, so the screens say "Updating".
#[tauri::command]
fn setup_info() -> bool {
  app_exe().exists()
}

#[tauri::command]
fn setup_install(app: AppHandle) {
  thread::spawn(move || {
    let ok = run(&app).is_ok();
    let _ = app.emit("setup://done", ok);
  });
}

// Progress bands: unpack 0-10, copy 10-90, finish 90-100.
fn run(app: &AppHandle) -> Result<(), String> {
  // 1. Unpacking: write the embedded installer to a temp file.
  emit(app, 0.0, "unpack");
  let path = std::env::temp_dir().join(format!("5pm-installer-{}.exe", std::process::id()));
  {
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    let total = INSTALLER.len().max(1);
    for (i, chunk) in INSTALLER.chunks(256 * 1024).enumerate() {
      file.write_all(chunk).map_err(|e| e.to_string())?;
      let written = ((i + 1) * 256 * 1024).min(total);
      emit(app, 10.0 * written as f64 / total as f64, "unpack");
    }
  }

  // 2. Copying: run NSIS silently and watch app.exe being written. NSIS kills a
  //    running 5pm itself and installs over the existing copy, keeping data.
  let target = app_exe();
  let expected = APP_EXE_SIZE.parse::<u64>().unwrap_or(1).max(1);
  let started = SystemTime::now();
  emit(app, 10.0, "copy");
  let mut child = Command::new(&path)
    .arg("/S")
    .creation_flags(CREATE_NO_WINDOW)
    .spawn()
    .map_err(|e| e.to_string())?;

  let mut finish_pct = 90.0;
  let mut frac: f64 = 0.0;
  let status = loop {
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
      break status;
    }
    // During an update the old app.exe is already full size, so the file only
    // counts once NSIS has touched it in this run (fresh mtime). NSIS stamps the
    // original build time back when the file is done, so a full-size file seen
    // after writing began also counts as done. Never goes backwards.
    if let Ok(m) = fs::metadata(&target) {
      let fresh = m.modified().map(|t| t >= started).unwrap_or(false);
      let now = if fresh {
        m.len() as f64 / expected as f64
      } else if frac > 0.0 && m.len() >= expected {
        1.0
      } else {
        0.0
      };
      frac = frac.max(now.min(1.0));
    }
    if frac < 1.0 {
      emit(app, 10.0 + 80.0 * frac, "copy");
    } else {
      // 3. Finishing up: shortcuts, registry, uninstaller. Creep toward 99
      //    until NSIS exits, so the bar never claims done before it is.
      finish_pct += (99.0 - finish_pct) * 0.15;
      emit(app, finish_pct, "finish");
    }
    thread::sleep(Duration::from_millis(100));
  };

  let _ = fs::remove_file(&path);
  if !status.success() || !target.exists() {
    return Err(format!("installer exited with {status}"));
  }
  emit(app, 100.0, "finish");
  Ok(())
}

#[tauri::command]
fn setup_launch(app: AppHandle) -> Result<(), String> {
  Command::new(app_exe()).spawn().map_err(|e| e.to_string())?;
  app.exit(0);
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![setup_info, setup_install, setup_launch])
    .run(tauri::generate_context!())
    .expect("error while running 5pm Setup");
}
