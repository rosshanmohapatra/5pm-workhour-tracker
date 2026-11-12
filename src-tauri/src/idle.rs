// Background mode: what 5pm does while nobody can see it.
//
// 5pm spends most of the day hidden in the tray (closing the window only hides
// it, see shell.rs) or minimised. The page keeps running so its timers still
// fire the session alerts, but there is nothing on screen to draw. So while
// hidden:
//   - WebView2 is asked to use as little memory as it can (MemoryUsageTargetLevel
//     Low: it trims caches and lets Windows page out what it isn't using). Script
//     and timers keep running at full speed; this is Microsoft's own setting for
//     apps that sit in the background.
//   - the page gets html.app-hidden, which pauses every looping CSS animation
//     (live dots, progress shimmer, spinners) so the GPU stops drawing frames
//     nobody sees.
// Showing the window undoes both, before the first frame, so nothing looks different.

use tauri::{Runtime, WebviewWindow};

pub fn set_background<R: Runtime>(window: &WebviewWindow<R>, hidden: bool) {
  let js = if hidden {
    "document.documentElement.classList.add('app-hidden')"
  } else {
    "document.documentElement.classList.remove('app-hidden')"
  };
  let _ = window.eval(js);

  #[cfg(windows)]
  let _ = window.with_webview(move |wv| unsafe {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
      ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
      COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let level = if hidden {
      COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
      COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    // ICoreWebView2_19 needs WebView2 Runtime 114+ (every supported Windows 10/11
    // has it); on anything older the cast fails and nothing changes.
    if let Ok(core) = wv.controller().CoreWebView2() {
      if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
        let _ = core19.SetMemoryUsageTargetLevel(level);
      }
    }
  });
}

// Hidden to the tray, or minimised to the taskbar: either way nothing is on screen.
pub fn is_out_of_sight<R: Runtime>(window: &WebviewWindow<R>) -> bool {
  !window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false)
}
