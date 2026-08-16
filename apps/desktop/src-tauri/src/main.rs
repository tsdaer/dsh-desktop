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

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, Url, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

/// Holds the spawned runtime so it can be terminated at app exit.
struct DshRuntime(Mutex<Option<Child>>);

/// Ordered splash status board the splashscreen page polls via `splash_status`.
/// The low-level `window.__TAURI_INTERNALS__` bridge is always injected, but the
/// `withGlobalTauri` high-level API is not (no @tauri-apps/api dependency), so
/// status flows Rust -> board -> poll rather than Rust -> event -> listener.
struct SplashBoard(Mutex<Vec<serde_json::Value>>);

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
        // `resource_dir` returns a `\\?\` verbatim path on Windows, which node's
        // realpath cannot resolve (EISDIR on the drive letter); strip it before
        // handing the path to node or converting it to a file URL.
        let resource_cli = handle
            .path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("runtime").join("lib").join("bin.js"))
            .filter(|path| path.exists())
            .map(|path| dunce::simplified(&path).to_owned())?;
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
        .plugin(tauri_plugin_opener::init())
        .manage(DshRuntime(Mutex::new(None)))
        .manage(SplashBoard(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![set_debug_mode, splash_start, splash_status, splash_open_webview2_download])
        .setup(|app| {
            splash_log(&format!(
                "setup: main window found = {}",
                app.get_webview_window("main").is_some()
            ));
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
        // Packaged mode keeps the profile's bridge in lockstep with the
        // runtime's on every boot: the bridge lib is a build artifact that
        // source changes refresh, so a one-time copy would leave the profile
        // on stale behavior after an upgrade (missing routes, dead plugin).
        // Dev mode (tarballs) installs once and leaves refreshes to the
        // developer.
        if !paths.bridge_copy.is_empty() {
            copy_bridge_packages(&profile, &paths.bridge_copy);
        }
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
    // The profile template ships a comment header plus an empty `[]` list.
    // Replace that empty list with the bridge rows so they join the existing
    // array; appending after it would emit a second YAML document and break
    // the profile parse.
    let merged = if existing.contains("[]") {
        existing.replacen("[]", &source, 1)
    } else {
        let mut merged = existing;
        if !merged.is_empty() && !merged.ends_with('\n') {
            merged.push('\n');
        }
        merged.push_str(&source);
        merged
    };
    if std::fs::write(&profile_patch, merged).is_ok() {
        eprintln!("[dsh-desktop] bridge rows appended to {}; edit the desktop-bridge config there", profile_patch.display());
    } else {
        eprintln!("[dsh-desktop] failed to append bridge rows to {}", profile_patch.display());
    }
}

/// Append a diagnostic line to the splash log file. A Windows GUI-subsystem app
/// has no console, so stderr is invisible; the file is the diagnostic channel.
fn splash_log(message: &str) {
    let path = std::env::temp_dir().join("dsh-desktop-splash.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

/// Record a splash status entry on the polled board; the latest write for a
/// step wins, and the splashscreen page renders the board on each poll.
fn push_status(handle: &tauri::AppHandle, step: &str, status: &str, message: &str, suggestion: Option<&str>) {
    splash_log(&format!("push_status: {step} = {status}"));
    let entry = serde_json::json!({ "step": step, "status": status, "message": message, "suggestion": suggestion });
    if let Some(board) = handle.try_state::<SplashBoard>() {
        let mut list = board.0.lock().unwrap();
        if let Some(existing) = list.iter_mut().find(|e| e["step"].as_str() == Some(step)) {
            *existing = entry;
        } else {
            list.push(entry);
        }
    }
}

/// Resolve the runtime wiring: env wins (dev launcher), a packaged app falls
/// back to its own resources. Without either, the dev launcher hint surfaces.
fn resolve_paths(handle: &tauri::AppHandle) -> RuntimePaths {
    splash_log(&format!(
        "resolve_paths: DSH_CLI set={}, resource_dir={:?}",
        std::env::var("DSH_CLI").is_ok(),
        handle.path().resource_dir().ok()
    ));
    if std::env::var("DSH_CLI").is_ok() {
        RuntimePaths::from_env()
    } else if let Some(paths) = RuntimePaths::packaged(handle) {
        println!("[dsh-desktop] packaged runtime at {}", paths.cli);
        paths
    } else {
        RuntimePaths::from_env()
    }
}

/// The home directory the runtime persists into (mirrors `ensure_bridge`).
fn dsh_home() -> String {
    std::env::var("DSH_HOME").unwrap_or_else(|_| {
        let base = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        format!("{base}/.dsh")
    })
}

/// Run the pre-boot environment checks, emitting a status for each. Returns
/// false when a fatal check failed (the splash stays up and offers a retry);
/// warn-only problems (a missing API key) do not block.
fn run_checks(handle: &tauri::AppHandle, paths: &RuntimePaths) -> bool {
    let mut fatal = false;

    // WebView2: rendering the splash already proves the runtime is present and
    // functional. Version/repair guidance lands in a later milestone.
    push_status(handle, "webview2", "ok", "WebView2 可用", None);

    // Node executable: a full path must exist; a bare command name is left for
    // the spawn below to surface.
    let node_is_path = paths.node.contains('/') || paths.node.contains('\\');
    if node_is_path && !Path::new(&paths.node).is_file() {
        push_status(handle, "node", "error", "未找到 Node 运行时", None);
        fatal = true;
    } else {
        push_status(handle, "node", "ok", paths.node.as_str(), None);
    }

    // dsh CLI entry.
    if paths.cli.is_empty() || !Path::new(&paths.cli).is_file() {
        push_status(handle, "runtime", "error", "dsh 运行时缺失", Some("请重新安装 dsh-desktop"));
        fatal = true;
    } else {
        push_status(handle, "runtime", "ok", "dsh 运行时就绪", None);
    }

    // Data directory: create it if missing; a failure to create it is fatal.
    let home = dsh_home();
    if std::fs::create_dir_all(&home).is_ok() {
        push_status(handle, "home", "ok", "数据目录可写", None);
    } else {
        push_status(handle, "home", "error", "无法创建数据目录", Some(format!("请检查 {home} 的权限").as_str()));
        fatal = true;
    }

    // API key: warn only — the user can configure it in the app.
    if std::env::var("DEEPSEEK_API_KEY").is_ok() {
        push_status(handle, "api-key", "ok", "已配置 API Key", None);
    } else {
        push_status(handle, "api-key", "warn", "未配置 DEEPSEEK_API_KEY（可稍后在设置中配置）", None);
    }

    !fatal
}

/// Run the splash flow: checks first, then bridge + boot. The splash closes and
/// the main window appears once the `dsh web:` readiness line arrives.
fn run_splash_flow(window: WebviewWindow, handle: tauri::AppHandle) {
    splash_log("run_splash_flow: begin");
    let paths = resolve_paths(&handle);
    splash_log(&format!("run_splash_flow: cli={} node={}", paths.cli, paths.node));
    if !run_checks(&handle, &paths) {
        splash_log("run_splash_flow: checks failed, staying on splash");
        return;
    }
    boot(window, handle, paths);
}

/// Return the current splash status board for the splashscreen page to render.
#[tauri::command]
fn splash_status(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    app.state::<SplashBoard>().0.lock().unwrap().clone()
}

/// Start the splash flow: run environment checks, then bridge + boot. Called by
/// the splashscreen page on load and again by its retry button; a fresh start
/// clears the board so stale entries never linger.
#[tauri::command]
fn splash_start(app: tauri::AppHandle) {
    splash_log("splash_start: invoked");
    app.state::<SplashBoard>().0.lock().unwrap().clear();
    std::thread::spawn(move || {
        // The main window's webview can lag the splash page's first command
        // round-trip; retry briefly before giving up.
        let window = (0..60).find_map(|i| {
            if i > 0 {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            app.get_webview_window("main")
        });
        match window {
            Some(window) => {
                splash_log("splash_start: main window found");
                run_splash_flow(window, app);
            }
            None => {
                splash_log("splash_start: main window NOT found after retries");
                push_status(&app, "runtime", "error", "主窗口未找到", None);
            }
        }
    });
}

/// Open the WebView2 Evergreen download page in the system browser. The splash
/// itself is a WebView2 page, so it cannot install a missing WebView2 runtime;
/// this routes the user to Microsoft's download for the repair/version case.
#[tauri::command]
fn splash_open_webview2_download(app: tauri::AppHandle) {
    let url = "https://developer.microsoft.com/microsoft-edge/webview2/";
    if let Err(err) = app.opener().open_url(url, None::<&str>) {
        eprintln!("[dsh-desktop] failed to open WebView2 download page: {err}");
    }
}

/// Spawn the dsh runtime, wait for readiness, and navigate the window.
fn boot(window: WebviewWindow, handle: tauri::AppHandle, paths: RuntimePaths) {
    if paths.cli.is_empty() {
        fail(
            &handle,
            "DSH_CLI is not set; point it at the dsh CLI entry (apps/cli/lib/bin.js). Run `node apps/desktop/scripts/dev.mjs`.",
        );
        return;
    }

    push_status(&handle, "bridge", "running", "准备桥接包", None);
    let patches = ensure_bridge(&paths.node, &paths.cli, &paths);
    push_status(&handle, "bridge", "ok", "桥接包就绪", None);

    push_status(&handle, "boot", "running", "启动 dsh 服务", None);
    splash_log(&format!(
        "boot: spawning `{} {} web --port 0` module_base={:?}",
        paths.node, paths.cli, paths.module_base
    ));
    let mut cmd = Command::new(&paths.node);
    cmd.arg(&paths.cli).arg("web");
    for patch in &patches {
        cmd.arg("--patch").arg(patch);
    }
    cmd.arg("--port").arg("0");
    if let Some(module_base) = &paths.module_base {
        cmd.env("DSH_BARE_MODULE_BASE", module_base);
    }
    // The runtime is a console-subsystem binary (node.exe); a GUI-subsystem
    // parent would otherwise give it a visible console window. CREATE_NO_WINDOW
    // keeps the spawn headless, and null stdin stops node from attaching to the
    // absent console.
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            fail(
                &handle,
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

    // Forward the runtime's stderr to the log (and console in dev).
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => {
                    splash_log(&format!("[dsh stderr] {line}"));
                    eprintln!("[dsh] {line}");
                }
                Err(_) => break,
            }
        }
    });

    // Collect stdout lines; forward non-readiness lines to the log.
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    splash_log(&format!("[dsh stdout] {line}"));
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
                                push_status(&handle, "boot", "ok", "dsh 服务就绪", None);
                                if let Some(splash) = handle.get_webview_window("splashscreen") {
                                    let _ = splash.close();
                                }
                                if let Err(err) = window.show() {
                                    fail(&handle, &format!("failed to show the main window: {err}"));
                                    return;
                                }
                                if window.navigate(url).is_err() {
                                    fail(&handle, "window is gone; cannot navigate");
                                    return;
                                }
                                // Inject the custom title bar once the dsh page
                                // settles; the script is idempotent, so retries
                                // are safe. The app version rides along as a
                                // window global (titlebar.js renders the badge).
                                let version = handle.package_info().version.to_string();
                                let inject = window.clone();
                                std::thread::spawn(move || inject_titlebar(&inject, &version));
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
                        &handle,
                        "dsh runtime did not become ready within 120s (no `dsh web:` readiness line)",
                    );
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                fail(&handle, "dsh runtime exited before printing its readiness line");
                return;
            }
        }
    }
}

/// Inject the shared title bar script (apps/desktop/src/titlebar.js) into the
/// loaded page. The script is idempotent and self-guarded, so it can be
/// evaluated repeatedly while the webview finishes navigation. The version
/// global is prepended rather than baked into the file so the loading page
/// (a plain <script src="titlebar.js">, no global) keeps rendering the bare
/// title.
fn inject_titlebar(window: &WebviewWindow, version: &str) {
    let script = format!(
        "window.__DSH_DESKTOP_VERSION__ = {};{}",
        js_string(version),
        include_str!("../../src/titlebar.js"),
    );
    let started = Instant::now();
    let mut last_ok = false;
    while started.elapsed() < Duration::from_secs(20) {
        match window.eval(&script) {
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

/// Report a boot failure: emit it to the splash checklist and, for failures
/// after the main window is shown, also surface it on the loading page.
fn fail(handle: &tauri::AppHandle, message: &str) {
    eprintln!("[dsh-desktop] boot failure: {message}");
    push_status(handle, "boot", "error", message, None);
    if let Some(window) = handle.get_webview_window("main") {
        let js = format!("window.__dshBootError({})", js_string(message));
        for _ in 0..40 {
            if window.eval(&js).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
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