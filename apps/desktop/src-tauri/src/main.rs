//! dsh-desktop — a minimal Tauri 2 shell that hosts the 'dsh web' profile.
//!
//! The shell spawns a Node process running the dsh CLI ('<cli> web --port 0'),
//! waits for the readiness URL line the web profile prints once its Loader
//! tree settles, and navigates the window to that URL. The runtime is resolved
//! from the environment:
//!
//! - 'DSH_NODE' — the Node executable (default: 'node' from PATH)
//! - 'DSH_CLI' — the dsh CLI entry, e.g. 'apps/cli/lib/bin.js' (required)
//!
//! Test-version scope: no bundled Node sidecar, no installer, no Linux
//! node-pty handling. See apps/desktop/README.md.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, Url, WebviewWindow};

/// Holds the spawned runtime so it can be terminated at app exit.
struct DshRuntime(Mutex<Option<Child>>);

/// How long to wait for the readiness URL line after spawning.
const BOOT_TIMEOUT: Duration = Duration::from_secs(120);

fn main() {
    tauri::Builder::default()
        .manage(DshRuntime(Mutex::new(None)))
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is configured");
            let handle = app.handle().clone();
            std::thread::spawn(move || boot(window, handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the tauri app")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<DshRuntime>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}

/// Spawn the dsh runtime, wait for readiness, and navigate the window.
fn boot(window: WebviewWindow, handle: tauri::AppHandle) {
    let node = std::env::var("DSH_NODE").unwrap_or_else(|_| "node".to_string());
    let cli = match std::env::var("DSH_CLI") {
        Ok(cli) => cli,
        Err(_) => {
            fail(
                &window,
                "DSH_CLI is not set; point it at the dsh CLI entry (apps/cli/lib/bin.js). Run `node apps/desktop/scripts/dev.mjs`.",
            );
            return;
        }
    };

    let mut child = match Command::new(&node)
        .arg(&cli)
        .arg("web")
        .arg("--port")
        .arg("0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            fail(
                &window,
                &format!("failed to spawn `{node} {cli} web --port 0`: {err}"),
            );
            return;
        }
    };

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    if let Some(state) = handle.try_state::<DshRuntime>() {
        *state.0.lock().unwrap() = Some(child);
    }

    // Forward the runtime's stderr to our console.
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => eprintln!("[dsh] {line}"),
                Err(_) => break,
            }
        }
    });

    // Collect stdout lines; forward non-readiness lines to our console.
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let deadline = Instant::now() + BOOT_TIMEOUT;
    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(line) => {
                if let Some(rest) = line.strip_prefix("dsh web: ") {
                    if let Some(candidate) = rest.split_whitespace().next() {
                        match Url::parse(candidate) {
                            Ok(url) => {
                                println!("[dsh-desktop] ready at {url}");
                                if window.navigate(url).is_err() {
                                    fail(&window, "window is gone; cannot navigate");
                                    return;
                                }
                                // Inject the custom title bar once the dsh page
                                // settles; the script is idempotent, so retries
                                // are safe.
                                let inject = window.clone();
                                std::thread::spawn(move || inject_titlebar(&inject));
                                return;
                            }
                            Err(err) => {
                                eprintln!("[dsh-desktop] unparsable URL line `{candidate}`: {err}");
                            }
                        }
                    }
                } else {
                    println!("[dsh] {line}");
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if Instant::now() > deadline {
                    fail(
                        &window,
                        "dsh runtime did not become ready within 120s (no `dsh web:` readiness line)",
                    );
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                fail(&window, "dsh runtime exited before printing its readiness line");
                return;
            }
        }
    }
}

/// Inject the shared title bar script (apps/desktop/src/titlebar.js) into the
/// loaded page. The script is idempotent and self-guarded, so it can be
/// evaluated repeatedly while the webview finishes navigation.
fn inject_titlebar(window: &WebviewWindow) {
    let script = include_str!("../../src/titlebar.js");
    let started = Instant::now();
    let mut last_ok = false;
    while started.elapsed() < Duration::from_secs(20) {
        match window.eval(script) {
            Ok(()) => {
                if !last_ok {
                    println!("[dsh-desktop] title bar injected");
                }
                last_ok = true;
            }
            Err(_) => last_ok = false,
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Report a boot failure on the loading page, retrying while it loads.
fn fail(window: &WebviewWindow, message: &str) {
    eprintln!("[dsh-desktop] boot failure: {message}");
    let js = format!("window.__dshBootError({})", js_string(message));
    for _ in 0..40 {
        if window.eval(&js).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Quote a string as a JavaScript string literal.
fn js_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
