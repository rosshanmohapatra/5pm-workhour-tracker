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

    let body = "<!doctype html><meta charset=utf-8><title>5pm</title>\
      <body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0\">\
      <p>Signed in. You can close this tab and return to 5pm.</p>";
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
