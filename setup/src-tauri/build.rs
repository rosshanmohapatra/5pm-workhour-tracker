// The setup app carries the real NSIS installers inside its own exe, one per
// architecture, and installs the one that fits the PC (see main.rs).
// FIVEPM_INSTALLER_X64 / _X86 are the paths to those installers
// (5pm_<ver>_x64-setup.exe, 5pm_<ver>_x86-setup.exe) and FIVEPM_APP_EXE_SIZE_X64
// / _X86 the sizes of the app.exe each installs, which is what the progress bar
// measures against. CI sets all four after building the main app twice.
fn main() {
  for arch in ["X64", "X86"] {
    let installer_var = format!("FIVEPM_INSTALLER_{arch}");
    let size_var = format!("FIVEPM_APP_EXE_SIZE_{arch}");
    println!("cargo:rerun-if-env-changed={installer_var}");
    println!("cargo:rerun-if-env-changed={size_var}");
    let installer = std::env::var(&installer_var)
      .unwrap_or_else(|_| panic!("set {installer_var} to the built 5pm NSIS installer"));
    println!("cargo:rerun-if-changed={installer}");
    let size = std::env::var(&size_var)
      .unwrap_or_else(|_| panic!("set {size_var} to the byte size of the built app.exe"));
    size.parse::<u64>().unwrap_or_else(|_| panic!("{size_var} must be a number"));
  }
  tauri_build::build()
}
