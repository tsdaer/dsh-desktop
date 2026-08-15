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
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, Url, WebviewWindow};

/// Holds the spawned runtime so it can be terminated at app exit.
struct DshRuntime(Mutex<Option<Child>>);

/// Runtime wiring resolved at boot: where Node and the dsh CLI live, the
/// bare-module base for the closed runtime, and how the desktop bridge packages
/// reach the web profile.
///
/// Dev (DSH_CLI set) keeps the launcher's env wiring: system node, repo-built
/// CLI, bridge tarballs via npm. A packaged app carries the runtime in its
/// resources and the bundled Node as a sidecar beside the exe; no npm exists,
/// so the bridge packages are copied into the profile instead of installed.
struct RuntimePaths {
    node: String,
    cli: String,
    /// `DSH_BARE_MODULE_BASE` for the spawned runtime: anchors bare plugin
    /// names to the runtime's own install when it is closed.
    module_base: Option<String>,
    /// Runtime `node_modules/@deepseek-ai` package dirs to copy into the
    /// profile (packaged, offline); empty in dev where npm installs tarballs.
    bridge_copy: Vec<PathBuf>,
    /// npm-installable bridge tarballs (dev mode, system npm present).
    bridge_tarballs: Vec<String>,
}

impl RuntimePaths {
    fn from_env() -> Self {
        RuntimePaths {
            node: std::env::var("DSH_NODE").unwrap_or_else(|_| "node".to_string()),
            cli: std::env::var("DSH_CLI").unwrap_or_default(),
            module_base: std::env::var("DSH_BARE_MODULE_BASE").ok(),
            bridge_copy: Vec::new(),
            bridge_tarballs: std::env::var("DSH_BRIDGE_TARBALL")
                .into_iter()
                .flat_map(|v| v.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>())
                .collect(),
        }
    }

    fn packaged(handle: &tauri::AppHandle) -> Option<Self> {
        let resource_cli = handle
            .path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("runtime").join("lib").join("bin.js"))
            .filter(|path| path.exists())?;
        let node = std::env::var("DSH_NODE").unwrap_or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.join("node.exe")))
                .filter(|path| path.exists())
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|| "node".to_string())
        });
        let module_base = std::env::var("DSH_BARE_MODULE_BASE").ok().or_else(|| {
            Url::from_file_path(&resource_cli).ok().map(|url| url.to_string())
        });
        let runtime_root = resource_cli
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .map(|dir| dir.to_path_buf())?;
        let bridge_copy = ["dsh-desktop-bridge", "dsh-desktop-bridge-client", "schemastery"]
            .into_iter()
            .map(|pkg| runtime_root.join("node_modules").join("@deepseek-ai").join(pkg))
            .filter(|path| path.exists())
            .collect();
        Some(RuntimePaths {
            node,
            cli: resource_cli.to_string_lossy().into_owned(),
            module_base,
            bridge_copy,
            bridge_tarballs: Vec::new(),
        })
    }

    fn is_online(&self) -> bool {
        !self.bridge_tarballs.is_empty()
    }
}

/// Toggle WebView2 DevTools availability (F12 / context-menu inspect).
/// The page suppresses right-click and devtools shortcuts on its own when
/// debug mode is off; this closes the browser-level escape hatch the page
/// cannot intercept (WebView2's own F12 handling).
#[tauri::command]
fn set_debug_mode(window: WebviewWindow, enabled: bool) {
    let _ = window.with_webview(move |platform_webview| {
        let controller = platform_webview.controller();
        unsafe {
            let _ = controller
                .CoreWebView2()
                .and_then(|webview| webview.Settings())
                .and_then(|settings| settings.SetAreDevToolsEnabled(enabled));
        }
    });
}

/// How long to wait for the readiness URL line after spawning.
const BOOT_TIMEOUT: Duration = Duration::from_secs(120);

fn main() {
    tauri::Builder::default()
        .manage(DshRuntime(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_debug_mode])
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

/// Ensure the bridge packages are present in the web profile and return the
/// patch overlays to mount. `DSH_PATCH` lists patch files (semicolon-
/// separated). Online mode installs the bridge tarballs into the profile via
/// npm (bundled with the system Node in dev); a closed runtime copies its
/// packaged bridge packages into the profile instead — no npm is available.
fn ensure_bridge(node: &str, cli: &str, paths: &RuntimePaths) -> Vec<String> {
    let patches: Vec<String> = std::env::var("DSH_PATCH")
        .into_iter()
        .flat_map(|v| v.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>())
        .collect();
    if paths.bridge_tarballs.is_empty() && paths.bridge_copy.is_empty() {
        return patches;
    }
    let home = std::env::var("DSH_HOME").unwrap_or_else(|_| {
        let base = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{base}/.dsh")
    });
    let profile = std::path::Path::new(&home).join("profiles").join("web");
    let marker = profile.join("node_modules").join("@deepseek-ai").join("dsh-desktop-bridge");
    if marker.join("package.json").exists() {
        return patches;
    }
    if !profile.exists() {
        // First boot: let the CLI initialize the web profile template.
        let _ = Command::new(node).arg(cli).arg("--profile").arg("web").arg("--dump-default-config").status();
    }
    if !profile.exists() {
        eprintln!("[dsh-desktop] profile {} missing after init; continuing without the bridge", profile.display());
        return patches;
    }
    let installed = if paths.is_online() {
        install_bridge_via_npm(&profile, &paths.bridge_tarballs)
    } else {
        copy_bridge_packages(&profile, &paths.bridge_copy)
    };
    if installed {
        eprintln!("[dsh-desktop] bridge installed into {}", profile.display());
        install_profile_patch(&profile);
    }
    patches
}

/// Install bridge tarballs into the profile via npm (dev mode).
fn install_bridge_via_npm(profile: &Path, bridge_tarballs: &[String]) -> bool {
    match Command::new("cmd")
        .args(["/c", "npm", "install", "--no-save"])
        .args(bridge_tarballs)
        .current_dir(profile)
        .status()
    {
        Ok(status) => status.success(),
        _ => {
            eprintln!("[dsh-desktop] bridge install into {} failed; continuing without it", profile.display());
            false
        }
    }
}

/// Copy the packaged bridge packages into the profile's node_modules (closed
/// runtime, offline). A recursive copy replaces npm's install: the bridge
/// packages plus their prod dependency (schemastery) travel from the runtime.
fn copy_bridge_packages(profile: &Path, sources: &[PathBuf]) -> bool {
    let mut ok = true;
    for source in sources {
        let Some(name) = source.file_name() else { continue };
        let target = profile.join("node_modules").join("@deepseek-ai").join(name);
        if copy_dir_recursive(source, &target).is_err() {
            eprintln!("[dsh-desktop] failed to copy bridge package {} into {}", source.display(), profile.display());
            ok = false;
        }
    }
    ok
}

/// Recursively copy a directory, replacing an existing target.
fn copy_dir_recursive(source: &Path, target: &Path) -> std::io::Result<()> {
    if target.exists() {
        std::fs::remove_dir_all(target)?;
    }
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let destination = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &destination)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

/// Append the bridge rows (installed bridge package's cordis.patch.yml) to
/// the profile's user patch layer, idempotently. Rows must live in the user
/// layer: a `--patch` overlay applies after it, so profile patches could not
/// configure bridge rows inserted there.
fn install_profile_patch(profile: &std::path::Path) {
    let bridge_patch = profile.join("node_modules").join("@deepseek-ai").join("dsh-desktop-bridge").join("cordis.patch.yml");
    let profile_patch = profile.join("cordis.patch.yml");
    let Ok(source) = std::fs::read_to_string(&bridge_patch) else {
        eprintln!("[dsh-desktop] bridge patch file missing; skipping profile patch install");
        return;
    };
    let existing = std::fs::read_to_string(&profile_patch).unwrap_or_default();
    if existing.contains("id: desktop-bridge") {
        return;
    }
    let mut merged = existing;
    if !merged.is_empty() && !merged.ends_with('\n') {
        merged.push('\n');
    }
    merged.push_str(&source);
    if std::fs::write(&profile_patch, merged).is_ok() {
        eprintln!("[dsh-desktop] bridge rows appended to {}; edit the desktop-bridge config there", profile_patch.display());
    } else {
        eprintln!("[dsh-desktop] failed to append bridge rows to {}", profile_patch.display());
    }
}

/// Spawn the dsh runtime, wait for readiness, and navigate the window.
fn boot(window: WebviewWindow, handle: tauri::AppHandle) {
    // Env wiring wins (dev launcher); a packaged app falls back to its own
    // resources. Without either, report the dev launcher hint.
    let paths = if std::env::var("DSH_CLI").is_ok() {
        RuntimePaths::from_env()
    } else if let Some(paths) = RuntimePaths::packaged(&handle) {
        println!("[dsh-desktop] packaged runtime at {}", paths.cli);
        paths
    } else {
        RuntimePaths::from_env()
    };
    if paths.cli.is_empty() {
        fail(
            &window,
            "DSH_CLI is not set; point it at the dsh CLI entry (apps/cli/lib/bin.js). Run `node apps/desktop/scripts/dev.mjs`.",
        );
        return;
    }

    let patches = ensure_bridge(&paths.node, &paths.cli, &paths);
    let mut cmd = Command::new(&paths.node);
    cmd.arg(&paths.cli).arg("web");
    for patch in &patches {
        cmd.arg("--patch").arg(patch);
    }
    cmd.arg("--port").arg("0");
    if let Some(module_base) = &paths.module_base {
        cmd.env("DSH_BARE_MODULE_BASE", module_base);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match cmd.spawn()
    {
        Ok(child) => child,
        Err(err) => {
            fail(
                &window,
                &format!("failed to spawn `{} {} web --port 0`: {err}", paths.node, paths.cli),
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