// 5pm never uses the microphone or the camera (user, 2026-11-15, after seeing
// 5pm in Windows › Privacy › Microphone). The page never asks for either; this
// makes sure the WebView2 engine underneath can't either: any microphone or
// camera request from web content is answered "deny" before Windows is asked.
// Other permission kinds (notifications, clipboard) keep their normal handling.

use tauri::{Runtime, WebviewWindow};

pub fn deny_media<R: Runtime>(window: &WebviewWindow<R>) {
  #[cfg(windows)]
  let _ = window.with_webview(|wv| unsafe {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
      COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
      COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_DENY,
    };
    use webview2_com::PermissionRequestedEventHandler;
    if let Ok(core) = wv.controller().CoreWebView2() {
      let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
        if let Some(args) = args {
          let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
          args.PermissionKind(&mut kind)?;
          if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
          }
        }
        Ok(())
      }));
      let mut token = 0i64;
      let _ = core.add_PermissionRequested(&handler, &mut token);
    }
  });
}
