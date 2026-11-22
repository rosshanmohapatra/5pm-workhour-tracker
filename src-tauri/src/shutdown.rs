// Windows shutdown or sign-out with a session running (#73 A, user 2026-11-22):
// before Windows closes 5pm, the page gets one chance to send its last
// check-in and any unsent change (window.__beforeShutdown in index-app.js).
// It ends nothing: a phone showing the session sees when this PC went quiet
// and can end the day at that time.
//
// The main window is subclassed to see WM_QUERYENDSESSION. The script is
// queued then; Windows sends WM_ENDSESSION once every app has agreed, and a
// short wait there lets the request leave before the process is closed.

use tauri::WebviewWindow;

#[cfg(windows)]
pub fn install(window: &WebviewWindow) {
  use windows::Win32::Foundation::HWND;
  use windows::Win32::UI::Shell::SetWindowSubclass;
  let Ok(h) = window.hwnd() else { return };
  // Lives as long as the app: the window is never destroyed (closing hides it to the tray).
  let data = Box::into_raw(Box::new(window.clone())) as usize;
  unsafe {
    let _ = SetWindowSubclass(HWND(h.0 as _), Some(on_message), 0x5f70, data);
  }
}

#[cfg(not(windows))]
pub fn install(_window: &WebviewWindow) {}

#[cfg(windows)]
unsafe extern "system" fn on_message(
  hwnd: windows::Win32::Foundation::HWND,
  msg: u32,
  wparam: windows::Win32::Foundation::WPARAM,
  lparam: windows::Win32::Foundation::LPARAM,
  _id: usize,
  data: usize,
) -> windows::Win32::Foundation::LRESULT {
  const WM_QUERYENDSESSION: u32 = 0x0011;
  const WM_ENDSESSION: u32 = 0x0016;
  if msg == WM_QUERYENDSESSION {
    let window = &*(data as *const WebviewWindow);
    let _ = window.eval("window.__beforeShutdown && window.__beforeShutdown()");
  } else if msg == WM_ENDSESSION && wparam.0 != 0 {
    // Shutting down for real: give the last save a moment to go out.
    std::thread::sleep(std::time::Duration::from_millis(1500));
  }
  windows::Win32::UI::Shell::DefSubclassProc(hwnd, msg, wparam, lparam)
}
