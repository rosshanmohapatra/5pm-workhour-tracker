// The setup app carries the real NSIS installer inside its own exe.
// FIVEPM_INSTALLER is the path to that installer (5pm_<ver>_x64-setup.exe) and
// FIVEPM_APP_EXE_SIZE the size of the app.exe it installs, which is what the
// progress bar measures against. CI sets both after building the main app.
fn main() {
  println!("cargo:rerun-if-env-changed=FIVEPM_INSTALLER");
  println!("cargo:rerun-if-env-changed=FIVEPM_APP_EXE_SIZE");
  let installer = std::env::var("FIVEPM_INSTALLER")
    .expect("set FIVEPM_INSTALLER to the built 5pm NSIS installer");
  println!("cargo:rerun-if-changed={installer}");
  let size = std::env::var("FIVEPM_APP_EXE_SIZE")
    .expect("set FIVEPM_APP_EXE_SIZE to the byte size of the built app.exe");
  size.parse::<u64>().expect("FIVEPM_APP_EXE_SIZE must be a number");
  tauri_build::build()
}
