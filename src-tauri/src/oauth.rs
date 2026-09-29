// Loopback listener for OAuth sign-in.
//
// Google refuses to complete a web-application OAuth flow when a custom URI
// scheme rides along in the request, so sign-in cannot return to fivepm://.
// It returns to http://localhost:47893 instead, which Google treats as an
// ordinary redirect, and this listener hands the code to the webview.
//
// Emailed links (password reset) still use fivepm://, because a temporary port
// is long gone by the time someone opens their inbox.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

use tauri::{AppHandle, Emitter};

pub const PORT: u16 = 47893;

// Served to the browser once sign-in returns. Colours mirror the app's success
// tokens and follow the OS light/dark setting, which Chrome reports here.
//
// Chrome only lets a script close a tab it opened, and this one was opened by
// Windows, so the close can be refused. The countdown swaps to a plain
// instruction in that case rather than leaving a promise the page cannot keep.
const SUCCESS_PAGE: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed in to 5pm</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #09090b; --muted: #71717a; --success: #16a34a; --success-bg: #f0fdf4;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --success: #4ade80; --success-bg: #052e16; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  main { text-align: center; padding: 24px; max-width: 320px; }
  .mark { width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 50%;
    background: var(--success-bg); display: grid; place-items: center; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
  p { font-size: 13px; color: var(--muted); margin: 0; }
</style></head>
<body>
  <main>
    <div class="mark">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--success)"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>You're Logged In</h1>
    <p id="msg">This tab will be closed in 5.</p>
  </main>
  <script>
    var left = 5;
    var msg = document.getElementById('msg');
    var timer = setInterval(function () {
      left -= 1;
      if (left > 0) { msg.textContent = 'This tab will be closed in ' + left + '.'; return; }
      clearInterval(timer);
      window.close();
      // Still here a moment later means the browser refused to close the tab.
      setTimeout(function () { msg.textContent = 'You can close this tab and return to 5pm.'; }, 250);
    }, 1000);
  </script>
</body></html>"#;

/// Binds the callback port and waits for the browser to arrive.
/// A second call while one is already waiting is a no-op: the listener that is
/// already parked on the port serves the retry.
#[tauri::command]
pub fn oauth_listen(app: AppHandle) -> Result<(), String> {
  let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
    Ok(l) => l,
    Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => return Ok(()),
    Err(e) => return Err(e.to_string()),
  };

  std::thread::spawn(move || {
    let Ok((mut stream, _)) = listener.accept() else {
      return;
    };

    let mut first_line = String::new();
    let _ = BufReader::new(&stream).read_line(&mut first_line);

    // "GET /?code=abc&state=xyz HTTP/1.1"
    let target = first_line.split_whitespace().nth(1).unwrap_or("/").to_string();

    let body = SUCCESS_PAGE;
    let _ = write!(
      stream,
      "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
      body.len(),
      body
    );
    let _ = stream.flush();

    let _ = app.emit("oauth://callback", format!("http://localhost:{PORT}{target}"));
  });

  Ok(())
}
