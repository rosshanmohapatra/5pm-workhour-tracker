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

// Served to the browser once sign-in returns: the approved "You're in" screen
// (5pm sign-in design #8), one card in 5pm's colours that follows the OS
// light/dark setting. "Open App" uses fivepm://, which brings the running app
// to the front. The page never closes itself: Chrome refuses, because Windows
// opened the tab, so the message just says the tab can be closed.
const SUCCESS_PAGE: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed in to 5pm</title>
<style>
  /* The approved #8 "Browser: done" screen: one centred card (uiarc login-centered),
     5pm cool graphite colours, follows the OS light/dark setting. All text >= 7:1. */
  :root { color-scheme: light dark;
    --bg: #eef0f4; --surface: #ffffff; --border: #dde1e8; --border-strong: #c3c8d2; --fg: #0c0e13; --muted: #474d59; --ok: #00774d; --hover: #f6f7fa; }
  @media (prefers-color-scheme: dark) { :root {
    --bg: #08090c; --surface: #13151a; --border: #22262f; --border-strong: #3b414d; --fg: #eef1f6; --muted: #a9b0bd; --ok: #74c7a0; --hover: #1c1f26; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; letter-spacing: -.01em; }
  main { width: min(100%, 420px); padding: 32px; border: 1px solid var(--border); border-radius: 24px; background: var(--surface); }
  svg { display: block; width: 48px; height: 48px; margin-bottom: 20px; color: var(--ok); }
  .ring { stroke-dasharray: 140; stroke-dashoffset: 140; animation: draw .36s cubic-bezier(.65,0,.35,1) .16s forwards; }
  .tick { stroke-dasharray: 32; stroke-dashoffset: 32; animation: draw .28s cubic-bezier(.16,1,.3,1) .52s forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  h1 { margin: 0 0 8px; font-size: 28px; font-weight: 400; line-height: 1.1; letter-spacing: -.03em; }
  p { margin: 0 0 24px; font-size: 15px; line-height: 1.45; color: var(--muted); }
  a { display: flex; min-height: 44px; align-items: center; justify-content: center; border: 1px solid var(--border-strong); border-radius: 14px;
    color: var(--fg); font-size: 14px; font-weight: 500; text-decoration: none; transition: background-color .15s; }
  a:hover { background: var(--hover); }
  a:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
  @media (max-width: 400px) { main { padding: 24px 20px; } h1 { font-size: 24px; } }
  @media (prefers-reduced-motion: reduce) { .ring, .tick { animation: none; stroke-dashoffset: 0; } }
</style></head>
<body>
  <main>
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <g transform="rotate(-90 24 24)"><circle class="ring" cx="24" cy="24" r="22.25" stroke-width="1.5"/></g>
      <path class="tick" d="M15.5 24.5l5.5 5.5 11.5-12" stroke-width="2"/>
    </svg>
    <h1>You&rsquo;re in</h1>
    <p>You can close this tab and return to 5pm.</p>
    <a href="fivepm://open">Open App</a>
  </main>
</body></html>"##;

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
